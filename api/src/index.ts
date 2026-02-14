import { buildApp } from "./server.js";

const PORT = Number(process.env.PORT || "8080");
const app = buildApp();

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
