import { describe, it, expect } from "vitest";
import { validateUrl, SsrfError } from "./ssrf.js";

describe("SSRF guard", () => {
  describe("private IPv4 addresses", () => {
    it("blocks 127.0.0.1 (loopback)", async () => {
      await expect(validateUrl("http://127.0.0.1/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://127.0.0.1/")).rejects.toThrow("Private IP address not allowed");
    });

    it("blocks 10.x.x.x range", async () => {
      await expect(validateUrl("http://10.0.0.1/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://10.255.255.255/")).rejects.toThrow(SsrfError);
    });

    it("blocks 172.16.x.x range", async () => {
      await expect(validateUrl("http://172.16.0.1/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://172.31.255.255/")).rejects.toThrow(SsrfError);
    });
    
    it("allows IPs just outside 172.16.x.x range", async () => {
      // 172.15.x.x should be allowed (just before 172.16.0.0)
      const result = await validateUrl("http://172.15.255.255/");
      expect(result.hostname).toBe("172.15.255.255");
      
      // 172.32.x.x should be allowed (just after 172.31.255.255)
      const result2 = await validateUrl("http://172.32.0.0/");
      expect(result2.hostname).toBe("172.32.0.0");
    });

    it("blocks 192.168.x.x range", async () => {
      await expect(validateUrl("http://192.168.0.1/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://192.168.255.255/")).rejects.toThrow(SsrfError);
    });

    it("enforces 192.168.x.x boundaries correctly", async () => {
      // 192.167.x.x should be allowed (just before 192.168.0.0)
      const beforeRange = await validateUrl("http://192.167.255.255/");
      expect(beforeRange.hostname).toBe("192.167.255.255");

      // 192.168.x.x should be blocked (inside range)
      await expect(validateUrl("http://192.168.0.0/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://192.168.128.1/")).rejects.toThrow(SsrfError);

      // 192.169.x.x should be allowed (just after 192.168.255.255)
      const afterRange = await validateUrl("http://192.169.0.0/");
      expect(afterRange.hostname).toBe("192.169.0.0");
    });

    it("enforces 172.16.0.0/12 boundaries and nearby public ranges", async () => {
      // Exact boundaries should be blocked
      await expect(validateUrl("http://172.16.0.0/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://172.31.255.255/")).rejects.toThrow(SsrfError);

      // Middle of range should be blocked
      await expect(validateUrl("http://172.20.10.5/")).rejects.toThrow(SsrfError);

      // Nearby public ranges should be allowed
      const lowerPublic = await validateUrl("http://172.15.255.255/");
      expect(lowerPublic.hostname).toBe("172.15.255.255");

      const upperPublic = await validateUrl("http://172.32.0.0/");
      expect(upperPublic.hostname).toBe("172.32.0.0");

      const unrelatedPublic = await validateUrl("http://173.0.0.1/");
      expect(unrelatedPublic.hostname).toBe("173.0.0.1");
    });

    it("blocks 0.0.0.0", async () => {
      await expect(validateUrl("http://0.0.0.0/")).rejects.toThrow(SsrfError);
    });

    it("blocks link-local addresses (169.254.x.x)", async () => {
      await expect(validateUrl("http://169.254.0.1/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://169.254.255.255/")).rejects.toThrow(SsrfError);
    });

    it("blocks CGNAT range (100.64.0.0/10)", async () => {
      await expect(validateUrl("http://100.64.0.0/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://100.127.255.255/")).rejects.toThrow(SsrfError);
    });
  });

  describe("cloud metadata IP", () => {
    it("blocks 169.254.169.254", async () => {
      await expect(validateUrl("http://169.254.169.254/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(SsrfError);
    });
  });

  describe("blocked hostnames", () => {
    it("blocks localhost", async () => {
      await expect(validateUrl("http://localhost/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://localhost/")).rejects.toThrow("Blocked hostname");
    });

    it("blocks localhost variants", async () => {
      await expect(validateUrl("http://localhost.localdomain/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://ip6-localhost/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://ip6-loopback/")).rejects.toThrow(SsrfError);
    });
  });

  describe("IPv6 addresses", () => {
    it("blocks ::1 (loopback)", async () => {
      await expect(validateUrl("http://[::1]/")).rejects.toThrow(SsrfError);
    });

    it("blocks link-local fe80::/10 range", async () => {
      await expect(validateUrl("http://[fe80::1]/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://[fe90::1]/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://[fea0::1]/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://[febf::1]/")).rejects.toThrow(SsrfError);
    });

    it("blocks unique local addresses (fc00::/7)", async () => {
      await expect(validateUrl("http://[fc00::1]/")).rejects.toThrow(SsrfError);
      await expect(validateUrl("http://[fd00::1]/")).rejects.toThrow(SsrfError);
    });

    it("blocks deprecated site-local addresses (fec0::/10)", async () => {
      await expect(validateUrl("http://[fec0::1]/")).rejects.toThrow(SsrfError);
    });
  });

  describe("protocol validation", () => {
    it("blocks file:// protocol", async () => {
      await expect(validateUrl("file:///etc/passwd")).rejects.toThrow(SsrfError);
      await expect(validateUrl("file:///etc/passwd")).rejects.toThrow("Protocol not allowed");
    });

    it("blocks ftp:// protocol", async () => {
      await expect(validateUrl("ftp://example.com/")).rejects.toThrow(SsrfError);
    });

    it("allows http://", async () => {
      // This will fail DNS lookup in test environment, but protocol check passes
      // We check it doesn't fail on protocol validation
      try {
        await validateUrl("http://example.com/");
      } catch (error) {
        // Should fail on DNS, not protocol
        expect(error).toBeInstanceOf(SsrfError);
        expect((error as Error).message).not.toContain("Protocol not allowed");
      }
    });

    it("allows https://", async () => {
      // This will fail DNS lookup in test environment, but protocol check passes
      try {
        await validateUrl("https://example.com/");
      } catch (error) {
        // Should fail on DNS, not protocol
        expect(error).toBeInstanceOf(SsrfError);
        expect((error as Error).message).not.toContain("Protocol not allowed");
      }
    });
  });

  describe("invalid URLs", () => {
    it("rejects malformed URLs", async () => {
      await expect(validateUrl("not-a-url")).rejects.toThrow(SsrfError);
      await expect(validateUrl("not-a-url")).rejects.toThrow("Invalid URL");
    });
  });

  describe("public IPs", () => {
    it("allows public IPv4 addresses", async () => {
      // Using well-known public IPs (Google DNS)
      const result = await validateUrl("http://8.8.8.8/");
      expect(result.hostname).toBe("8.8.8.8");
      expect(result.resolvedIp).toBe("8.8.8.8");
      expect(result.port).toBe(80);
    });

    it("extracts port from URL", async () => {
      const result = await validateUrl("http://8.8.8.8:8080/");
      expect(result.port).toBe(8080);
    });

    it("uses default port 443 for https", async () => {
      const result = await validateUrl("https://8.8.8.8/");
      expect(result.port).toBe(443);
    });
  });
});
