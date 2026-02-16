#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/create-release.sh <tag> [options]

Description:
  Generates GitHub release notes from CHANGELOG.md using OpenAI,
  creates and pushes an annotated git tag, then creates a GitHub release.

Options:
  --title <title>            Release title (default: <tag>)
  --target <git-ref>         Ref to tag (default: HEAD)
  --repo <owner/repo>        GitHub repository (default: current gh repo)
  --changelog <path>         Changelog path (default: CHANGELOG.md)
  --model <model>            OpenAI model (default: gpt-5.1-codex-mini)
  --draft                    Create release as draft
  --prerelease               Mark release as prerelease
  --dry-run                  Print generated release notes, skip tag/release creation
  -h, --help                 Show this help

Environment:
  OPENAI_API_KEY             Required for OpenAI note generation

Requires:
  git, gh, jq, curl
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command not found: $cmd" >&2
    exit 1
  fi
}

extract_latest_changelog_section() {
  local path="$1"
  awk '
    BEGIN { in_section = 0 }
    /^## / {
      if (in_section == 0) {
        in_section = 1
        print
        next
      }
      exit
    }
    {
      if (in_section == 1) print
    }
  ' "$path"
}

extract_response_content() {
  local response="$1"
  local content

  content=$(echo "$response" | jq -r '.output[]? | select(.type == "message") | .content[]? | select(.type == "output_text" or .type == "text") | .text // empty' | sed '/^$/d' || true)
  if [[ -z "$content" ]]; then
    content=$(echo "$response" | jq -r '.output_text // empty' || true)
  fi

  content=$(echo "$content" | sed -E 's/^```json[[:space:]]*//; s/^```[[:space:]]*//; s/[[:space:]]*```$//')
  printf "%s" "$content"
}

TAG=""
TITLE=""
TARGET="HEAD"
REPO=""
CHANGELOG_PATH="CHANGELOG.md"
MODEL="gpt-5.1-codex-mini"
DRAFT=false
PRERELEASE=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      TITLE="${2:-}"
      shift 2
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --changelog)
      CHANGELOG_PATH="${2:-}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    --draft)
      DRAFT=true
      shift
      ;;
    --prerelease)
      PRERELEASE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Error: Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -z "$TAG" ]]; then
        TAG="$1"
      else
        echo "Error: Unexpected argument: $1" >&2
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "Error: tag is required" >&2
  usage
  exit 1
fi

if [[ -z "$TITLE" ]]; then
  TITLE="$TAG"
fi

for cmd in git gh jq curl; do
  require_cmd "$cmd"
done

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Error: OPENAI_API_KEY is required" >&2
  exit 1
fi

if [[ ! -f "$CHANGELOG_PATH" ]]; then
  echo "Error: changelog not found at $CHANGELOG_PATH" >&2
  exit 1
fi

if ! git rev-parse --verify "$TARGET^{commit}" >/dev/null 2>&1; then
  echo "Error: target ref '$TARGET' is not a valid commit" >&2
  exit 1
fi

if [[ -z "$REPO" ]]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Error: local tag already exists: $TAG" >&2
  exit 1
fi

if git ls-remote --tags origin "refs/tags/$TAG" | grep -q "$TAG"; then
  echo "Error: remote tag already exists on origin: $TAG" >&2
  exit 1
fi

LATEST_CHANGELOG_SECTION=$(extract_latest_changelog_section "$CHANGELOG_PATH")
if [[ -z "$LATEST_CHANGELOG_SECTION" ]]; then
  echo "Error: failed to parse latest section from $CHANGELOG_PATH" >&2
  exit 1
fi

CHANGELOG_PREVIEW=$(sed -n '1,260p' "$CHANGELOG_PATH")
PREVIOUS_TAG=$(git tag --sort=-version:refname | grep '^v' | head -n 1 || true)
COMPARE_URL=""
if [[ -n "$PREVIOUS_TAG" ]]; then
  COMPARE_URL="https://github.com/$REPO/compare/$PREVIOUS_TAG...$TAG"
fi

read -r -d '' SYSTEM_PROMPT <<'EOF' || true
You are writing GitHub release notes for a software project.

Return JSON only in the format:
{
  "title": "...",
  "body": "..."
}

Rules:
- Body must be valid Markdown.
- Keep it concise, concrete, and release-ready.
- Use this structure when possible:
  1) A short overview paragraph (1-2 sentences)
  2) "## Highlights" with grouped bullets from Added/Changed/Fixed
  3) "## Upgrade Notes" with operational implications (if any)
  4) "## Links" with compare URL only when provided
- Mention only changes present in the provided changelog context.
- Prefer user-impact wording over implementation internals.
- Do not invent changes.
EOF

read -r -d '' USER_PROMPT <<EOF || true
Repository: $REPO
Release tag: $TAG
Requested title: $TITLE
Previous tag: ${PREVIOUS_TAG:-none}
Compare URL: ${COMPARE_URL:-none}

Latest changelog section:
$LATEST_CHANGELOG_SECTION

Changelog preview (for context):
$CHANGELOG_PREVIEW

Return release notes that are polished for GitHub Releases and easy to scan.
If Compare URL is not "none", include it as a markdown link under "## Links".
If Compare URL is "none", do not include "## Links" or "## Full Changelog" sections.
EOF

PAYLOAD=$(jq -n \
  --arg model "$MODEL" \
  --arg system "$SYSTEM_PROMPT" \
  --arg user "$USER_PROMPT" \
  '{
    model: $model,
    instructions: $system,
    input: $user,
    max_output_tokens: 2200,
    text: { format: { type: "json_object" } }
  }')

RESPONSE=$(curl -sS -X POST "https://api.openai.com/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d "$PAYLOAD")

if [[ "$(echo "$RESPONSE" | jq -r '.error.message // empty')" != "" ]]; then
  echo "Error: OpenAI API error: $(echo "$RESPONSE" | jq -r '.error.message')" >&2
  exit 1
fi

CONTENT=$(extract_response_content "$RESPONSE")
if [[ -z "$CONTENT" || "$CONTENT" == "null" ]]; then
  echo "Error: empty response content from OpenAI" >&2
  exit 1
fi

if ! echo "$CONTENT" | jq -e '.title and .body' >/dev/null 2>&1; then
  echo "Error: OpenAI response missing title/body JSON fields" >&2
  echo "$CONTENT" >&2
  exit 1
fi

RELEASE_TITLE=$(echo "$CONTENT" | jq -r '.title')
RELEASE_BODY=$(echo "$CONTENT" | jq -r '.body')

if [[ -z "$COMPARE_URL" ]]; then
  RELEASE_BODY=$(printf "%s\n" "$RELEASE_BODY" | awk '
    BEGIN { skip = 0 }
    /^## (Links|Full Changelog)$/ { skip = 1; next }
    /^## / { skip = 0 }
    {
      if (skip == 1) next
      if ($0 ~ /https:\/\/github\.com\/.+\/compare\//) next
      print
    }
  ')
fi

if [[ -z "$RELEASE_TITLE" || "$RELEASE_TITLE" == "null" ]]; then
  RELEASE_TITLE="$TITLE"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[dry-run] tag: $TAG"
  echo "[dry-run] target: $TARGET"
  echo "[dry-run] repo: $REPO"
  echo
  echo "Release title:"
  echo "$RELEASE_TITLE"
  echo
  echo "Release body:"
  echo "$RELEASE_BODY"
  exit 0
fi

echo "Creating and pushing tag $TAG at $TARGET..."
git tag -a "$TAG" "$TARGET" -m "Release $TAG"
git push origin "$TAG"

echo "Creating GitHub release $TAG..."
args=(release create "$TAG" --repo "$REPO" --title "$RELEASE_TITLE" --notes "$RELEASE_BODY")
if [[ "$DRAFT" == "true" ]]; then
  args+=(--draft)
fi
if [[ "$PRERELEASE" == "true" ]]; then
  args+=(--prerelease)
fi

gh "${args[@]}"
echo "Release created: $TAG"
