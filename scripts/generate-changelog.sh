#!/usr/bin/env bash
#
# generate-changelog.sh
#
# Generates a changelog entry for a PR using the OpenAI API and merges it into CHANGELOG.md.
# If an entry for the same PR already exists, it will be replaced. Other entries are preserved.
#
# Usage:
#   ./generate-changelog.sh [--dry-run]                  # Uses current branch's PR
#   ./generate-changelog.sh [PR_NUMBER] [--dry-run]
#   ./generate-changelog.sh --backfill [--clear]
#
# Options:
#   --dry-run    Print the entry without modifying CHANGELOG.md
#   --backfill   Iterate closed PRs and generate entries recursively
#   --clear      With --backfill: reset CHANGELOG.md header first and rebuild all entries
#
# Required environment variables:
#   OPENAI_API_KEY  - OpenAI API key
#
# Optional environment variables:
#   CHANGELOG_PATH  - Path to CHANGELOG.md (default: CHANGELOG.md)
#
# Requires: gh (GitHub CLI), jq, curl
#
set -euo pipefail

# Parse arguments
DRY_RUN=false
BACKFILL=false
CLEAR=false
PR_NUMBER=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --backfill)
      BACKFILL=true
      shift
      ;;
    --clear)
      CLEAR=true
      shift
      ;;
    *)
      if [[ -z "$PR_NUMBER" ]]; then
        if [[ "$1" =~ ^[0-9]+$ ]]; then
          PR_NUMBER="$1"
        else
          echo "Error: Invalid argument '$1'. Expected a PR number or supported flag." >&2
          exit 1
        fi
      else
        echo "Error: Unexpected extra argument '$1'." >&2
        exit 1
      fi
      shift
      ;;
  esac
done

# Validate required tools
for cmd in gh jq; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "Error: $cmd is required but not installed" >&2
    exit 1
  fi
done

# Defaults
CHANGELOG_PATH="${CHANGELOG_PATH:-CHANGELOG.md}"
MAX_PRS="${MAX_PRS:-1000}"
MAX_RETRIES="${MAX_RETRIES:-3}"
BACKOFF_BASE_SECONDS="${BACKOFF_BASE_SECONDS:-2}"
DEBUG_DIR="${DEBUG_DIR:-tmp/changelog-debug}"
MAX_OUTPUT_TOKENS="${MAX_OUTPUT_TOKENS:-8000}"
MAX_OUTPUT_TOKENS_CAP="${MAX_OUTPUT_TOKENS_CAP:-16000}"

is_debug_enabled() {
  case "${DEBUG:-}" in
    1|true|TRUE|True)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

write_debug_artifacts() {
  local base="$1"
  local request_payload="$2"
  local response_body="$3"
  local content_body="${4:-}"

  if ! is_debug_enabled; then
    return 0
  fi

  mkdir -p "$DEBUG_DIR"
  printf "%s\n" "$request_payload" > "${base}.request.json"
  printf "%s\n" "$response_body" > "${base}.response.json"
  if [[ -n "$content_body" ]]; then
    printf "%s\n" "$content_body" > "${base}.content.txt"
    echo "Debug artifacts written: ${base}.request.json, ${base}.response.json, ${base}.content.txt" >&2
  else
    echo "Debug artifacts written: ${base}.request.json, ${base}.response.json" >&2
  fi
}

HEADER=$(cat <<'EOF'
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

---
EOF
)

if [[ "$BACKFILL" == "true" ]]; then
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    echo "Error: OPENAI_API_KEY is required for --backfill" >&2
    exit 1
  fi

  echo "Fetching closed pull requests for iterative backfill..." >&2
  PR_NUMBERS=$(gh pr list \
    --state closed \
    --limit "$MAX_PRS" \
    --json number,closedAt \
    | jq -r 'map(select(.closedAt != null)) | sort_by(.closedAt, .number) | .[].number')

  if [[ -z "$PR_NUMBERS" ]]; then
    echo "No closed pull requests found for backfill." >&2
    exit 0
  fi

  if [[ "$CLEAR" == "true" || ! -f "$CHANGELOG_PATH" ]]; then
    printf "%s\n" "$HEADER" > "$CHANGELOG_PATH"
    echo "Initialized $CHANGELOG_PATH (clear=${CLEAR})." >&2
  fi

  COUNT=0
  SKIP_COUNT=0
  FAIL_COUNT=0
  FAILED_PRS=""
  while IFS= read -r pr; do
    [[ -z "$pr" ]] && continue
    COUNT=$((COUNT + 1))

    if [[ "$CLEAR" != "true" && -f "$CHANGELOG_PATH" ]] && grep -Eq "\[#${pr}\]\(" "$CHANGELOG_PATH"; then
      SKIP_COUNT=$((SKIP_COUNT + 1))
      echo "[$COUNT] Skipping PR #$pr (already present)" >&2
      continue
    fi

    echo "[$COUNT] Generating changelog entry for PR #$pr" >&2
    if ! bash "$0" "$pr"; then
      FAIL_COUNT=$((FAIL_COUNT + 1))
      FAILED_PRS="${FAILED_PRS} #${pr}"
      echo "Warning: failed to generate entry for PR #$pr (continuing)" >&2
    fi
  done <<< "$PR_NUMBERS"

  echo "Backfill complete. total=$COUNT skipped=$SKIP_COUNT failures=$FAIL_COUNT" >&2
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo "Backfill had $FAIL_COUNT failures:${FAILED_PRS}" >&2
    exit 1
  fi
  exit 0
fi

# Validate tools/environment for OpenAI single-PR mode
if ! command -v curl &> /dev/null; then
  echo "Error: curl is required but not installed" >&2
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Error: OPENAI_API_KEY is required" >&2
  exit 1
fi

# Fetch PR metadata using gh CLI
if [[ -n "$PR_NUMBER" ]]; then
  echo "Fetching PR #${PR_NUMBER} metadata..." >&2
  if ! PR_JSON=$(gh pr view "$PR_NUMBER" --json number,title,body,additions,deletions,changedFiles,files,url,closedAt); then
    echo "Error: Failed to fetch metadata for PR #${PR_NUMBER}. Ensure the PR exists and you have access to it." >&2
    exit 1
  fi
else
  echo "Fetching current branch PR metadata..." >&2
  if ! PR_JSON=$(gh pr view --json number,title,body,additions,deletions,changedFiles,files,url,closedAt); then
    echo "Error: No PR found for current branch. Specify a PR number or run from a PR branch." >&2
    exit 1
  fi
  PR_NUMBER=$(echo "$PR_JSON" | jq -r '.number')
fi

PR_CLOSED_AT=$(echo "$PR_JSON" | jq -r '.closedAt // empty')
if [[ -n "$PR_CLOSED_AT" ]]; then
  TODAY=$(echo "$PR_JSON" | jq -r '.closedAt | fromdateiso8601 | strftime("%B %d, %Y")')
else
  TODAY=$(LC_ALL=C date +"%B %d, %Y")
fi

PR_TITLE=$(echo "$PR_JSON" | jq -r '.title')
PR_BODY=$(echo "$PR_JSON" | jq -r '.body // "No description provided."')
# Handle null/empty PR body explicitly
if [[ "$PR_BODY" == "null" || -z "$PR_BODY" ]]; then
  PR_BODY="No description provided."
fi
PR_ADDITIONS=$(echo "$PR_JSON" | jq -r '.additions')
PR_DELETIONS=$(echo "$PR_JSON" | jq -r '.deletions')
PR_URL=$(echo "$PR_JSON" | jq -r '.url')
PR_FILES=$(echo "$PR_JSON" | jq -r '[(.files // [])[]?.path][0:50] | join(", ")')
if [[ -z "$PR_FILES" || "$PR_FILES" == "null" ]]; then
  PR_FILES="No files list provided by GitHub metadata"
fi

# Extract today's date section (if any) for deterministic local merge
EXISTING_SECTION=""
if [[ -f "$CHANGELOG_PATH" ]] && grep -q "## $TODAY" "$CHANGELOG_PATH"; then
  EXISTING_SECTION=$(awk -v date="## $TODAY" '
    $0 == date { found=1; next }
    found && /^## / { exit }
    found { print }
  ' "$CHANGELOG_PATH")
fi

# Build the prompt
read -r -d '' SYSTEM_PROMPT << 'SYSPROMPT' || true
You are a technical writer generating changelog entries for a software project.

You will receive PR metadata for a single pull request.

Your task:
1. Generate entry/entries for the given PR only
2. Return JSON containing only the entries for this PR

Output format (always use this):
{
  "entries": [
    {"category": "Added|Changed|Fixed|Reverted", "entry": "- **Title** ([#NUMBER](URL)): Description."},
    ...
  ]
}

Rules for generating entries:
1. Category selection:
   - "Added" for new features, endpoints, commands, capabilities, new files/scripts
   - "Changed" for modifications, refactors, documentation updates, improvements
   - "Fixed" for bug fixes, error corrections, security patches
   - "Reverted" for rollbacks or reverted changes
2. Title should be concise (2-6 words), derived from PR content
3. Description should be 1-3 sentences summarizing the key changes
4. Focus on WHAT changed and WHY it matters, not implementation details
5. For multi-feature PRs: create separate entries for distinct capabilities (e.g., new automation + enhanced documentation)
6. Return only entries for this PR number

Example output for a PR with automation + docs:
{
  "entries": [
    {"category": "Added", "entry": "- **Automated Changelog Generation** ([#184](url)): GitHub Actions workflow that generates changelog entries on PR approval using OpenAI API."},
    {"category": "Changed", "entry": "- **Enhanced CHANGELOG.md** ([#184](url)): Transformed 79 PR entries from basic titles to detailed entries with descriptions."}
  ]
}
SYSPROMPT

# Truncate PR body if too long (keep first 3000 chars)
PR_BODY_TRUNCATED="${PR_BODY:0:3000}"
if [[ ${#PR_BODY} -gt 3000 ]]; then
  PR_BODY_TRUNCATED="${PR_BODY_TRUNCATED}... [truncated]"
fi

# Truncate files list if too long
PR_FILES_TRUNCATED="${PR_FILES:0:1500}"
if [[ ${#PR_FILES} -gt 1500 ]]; then
  PR_FILES_TRUNCATED="${PR_FILES_TRUNCATED}... [truncated]"
fi

read -r -d '' USER_PROMPT << USERPROMPT || true
Generate changelog entries for this PR only. Respond with valid JSON only.

**PR Title:** ${PR_TITLE}
**PR Number:** #${PR_NUMBER}
**PR URL:** ${PR_URL}
**Stats:** +${PR_ADDITIONS} -${PR_DELETIONS} lines

**PR Description:**
${PR_BODY_TRUNCATED}

**Changed Files:**
${PR_FILES_TRUNCATED}
USERPROMPT

CONTENT=""
ENTRIES_COUNT=0
ATTEMPT=1
REQUEST_MAX_OUTPUT_TOKENS="$MAX_OUTPUT_TOKENS"
while [[ "$ATTEMPT" -le "$MAX_RETRIES" ]]; do
  JSON_PAYLOAD=$(jq -n \
    --arg system "$SYSTEM_PROMPT" \
    --arg user "$USER_PROMPT" \
    --argjson max_output_tokens "$REQUEST_MAX_OUTPUT_TOKENS" \
    '{
      model: "gpt-5.1-codex-mini",
      instructions: $system,
      input: $user,
      max_output_tokens: $max_output_tokens,
      text: {
        format: {
          type: "json_object"
        }
      }
    }')

  DEBUG_BASE="${DEBUG_DIR}/pr-${PR_NUMBER}-attempt-${ATTEMPT}-$(date +%s)"
  if ! RESPONSE=$(curl -sS -X POST "https://api.openai.com/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -d "$JSON_PAYLOAD"); then
    echo "Attempt ${ATTEMPT}/${MAX_RETRIES}: Failed to reach OpenAI API" >&2
    write_debug_artifacts "$DEBUG_BASE" "$JSON_PAYLOAD" ""
    if [[ "$ATTEMPT" -lt "$MAX_RETRIES" ]]; then
      BACKOFF_SECONDS=$((BACKOFF_BASE_SECONDS ** ATTEMPT))
      echo "Retrying in ${BACKOFF_SECONDS}s..." >&2
      sleep "$BACKOFF_SECONDS"
    fi
    ATTEMPT=$((ATTEMPT + 1))
    continue
  fi

  if [[ -z "$RESPONSE" ]]; then
    echo "Attempt ${ATTEMPT}/${MAX_RETRIES}: Empty response from OpenAI API" >&2
    write_debug_artifacts "$DEBUG_BASE" "$JSON_PAYLOAD" "$RESPONSE"
  elif ! echo "$RESPONSE" | jq -e . > /dev/null 2>&1; then
    echo "Attempt ${ATTEMPT}/${MAX_RETRIES}: Non-JSON response from OpenAI API" >&2
    if is_debug_enabled; then
      echo "Full response:" >&2
      echo "$RESPONSE" >&2
    fi
    write_debug_artifacts "$DEBUG_BASE" "$JSON_PAYLOAD" "$RESPONSE"
  elif [[ "$(echo "$RESPONSE" | jq -r '.error.message // empty')" != "" ]]; then
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error.message // "Unknown API error"')
    echo "Attempt ${ATTEMPT}/${MAX_RETRIES}: OpenAI API error: $ERROR_MSG" >&2
    if is_debug_enabled; then
      echo "Full response:" >&2
      echo "$RESPONSE" >&2
    fi
    write_debug_artifacts "$DEBUG_BASE" "$JSON_PAYLOAD" "$RESPONSE"
  else
    INCOMPLETE_REASON=$(echo "$RESPONSE" | jq -r '.incomplete_details.reason // .choices[0].finish_reason // empty')
    if [[ "$INCOMPLETE_REASON" == "max_output_tokens" || "$INCOMPLETE_REASON" == "length" ]]; then
      NEXT_MAX=$((REQUEST_MAX_OUTPUT_TOKENS * 2))
      if [[ "$NEXT_MAX" -gt "$MAX_OUTPUT_TOKENS_CAP" ]]; then
        NEXT_MAX="$MAX_OUTPUT_TOKENS_CAP"
      fi
      echo "Attempt ${ATTEMPT}/${MAX_RETRIES}: response truncated by max_output_tokens (${REQUEST_MAX_OUTPUT_TOKENS}); next retry will use ${NEXT_MAX}" >&2
      REQUEST_MAX_OUTPUT_TOKENS="$NEXT_MAX"
    fi

    CONTENT=$(echo "$RESPONSE" | jq -r '.output[] | select(.type == "message") | .content[0].text // empty')

    if [[ -z "$CONTENT" || "$CONTENT" == "null" ]]; then
      CONTENT=$(echo "$RESPONSE" | jq -r '.output_text // empty')
    fi

    if [[ -n "$CONTENT" ]]; then
      CONTENT=$(echo "$CONTENT" | sed -E 's/^```json[[:space:]]*//; s/^```[[:space:]]*//; s/[[:space:]]*```$//')
    fi

    if [[ -z "$CONTENT" || "$CONTENT" == "null" ]]; then
      echo "Attempt ${ATTEMPT}/${MAX_RETRIES}: Missing content in OpenAI response" >&2
      if is_debug_enabled; then
        echo "Full response:" >&2
        echo "$RESPONSE" >&2
      fi
      write_debug_artifacts "$DEBUG_BASE" "$JSON_PAYLOAD" "$RESPONSE"
    elif ! echo "$CONTENT" | jq -e '.entries' > /dev/null 2>&1; then
      echo "Attempt ${ATTEMPT}/${MAX_RETRIES}: Invalid JSON response - missing entries array" >&2
      if is_debug_enabled; then
        echo "Full extracted content:" >&2
        echo "$CONTENT" >&2
        echo "Full response:" >&2
        echo "$RESPONSE" >&2
      fi
      write_debug_artifacts "$DEBUG_BASE" "$JSON_PAYLOAD" "$RESPONSE" "$CONTENT"
    else
      ENTRIES_COUNT=$(echo "$CONTENT" | jq '.entries | length')
      if [[ "$ENTRIES_COUNT" -eq 0 ]]; then
        echo "Attempt ${ATTEMPT}/${MAX_RETRIES}: No entries generated" >&2
      else
        break
      fi
    fi
  fi

  if [[ "$ATTEMPT" -lt "$MAX_RETRIES" ]]; then
    BACKOFF_SECONDS=$((BACKOFF_BASE_SECONDS ** ATTEMPT))
    echo "Retrying in ${BACKOFF_SECONDS}s..." >&2
    sleep "$BACKOFF_SECONDS"
  fi
  ATTEMPT=$((ATTEMPT + 1))
done

if [[ -z "$CONTENT" || "$CONTENT" == "null" ]]; then
  echo "Error: Failed to generate changelog entry after ${MAX_RETRIES} attempts" >&2
  exit 1
fi

if ! echo "$CONTENT" | jq -e '.entries' > /dev/null 2>&1 || [[ "$ENTRIES_COUNT" -eq 0 ]]; then
  echo "Error: Failed to produce valid entries after ${MAX_RETRIES} attempts" >&2
  exit 1
fi

# Parse existing entries for today's section into JSON
EXISTING_ENTRIES_JSON='[]'
if [[ -n "$EXISTING_SECTION" ]]; then
  CURRENT_CATEGORY=""
  while IFS= read -r line; do
    if [[ "$line" =~ ^###\ (Added|Changed|Fixed|Reverted)$ ]]; then
      CURRENT_CATEGORY="${BASH_REMATCH[1]}"
      continue
    fi

    if [[ -n "$CURRENT_CATEGORY" && "$line" =~ ^-\  ]]; then
      EXISTING_ENTRIES_JSON=$(echo "$EXISTING_ENTRIES_JSON" | jq -c --arg category "$CURRENT_CATEGORY" --arg entry "$line" '. + [{category: $category, entry: $entry}]')
    fi
  done <<< "$EXISTING_SECTION"
fi

GENERATED_ENTRIES_JSON=$(echo "$CONTENT" | jq -c '.entries')
FILTERED_EXISTING_ENTRIES_JSON=$(echo "$EXISTING_ENTRIES_JSON" | jq -c --arg pr "$PR_NUMBER" '[.[] | select((.entry | test("\\[#" + $pr + "\\]\\(")) | not)]')
MERGED_ENTRIES_JSON=$(jq -cn --argjson existing "$FILTERED_EXISTING_ENTRIES_JSON" --argjson generated "$GENERATED_ENTRIES_JSON" '$existing + $generated')
SORTED_ENTRIES_JSON=$(echo "$MERGED_ENTRIES_JSON" | jq -c '
  def cat_rank: if . == "Added" then 0 elif . == "Changed" then 1 elif . == "Fixed" then 2 elif . == "Reverted" then 3 else 4 end;
  sort_by((.category | cat_rank), -(try (.entry | capture("\\[#(?<n>[0-9]+)\\]\\(").n | tonumber) catch 0))
')
MERGED_CONTENT=$(jq -cn --argjson entries "$SORTED_ENTRIES_JSON" '{entries: $entries}')
ENTRIES_COUNT=$(echo "$MERGED_CONTENT" | jq '.entries | length')

# Build the new date section from entries
# Group entries by category in order: Added, Changed, Fixed, Reverted
build_section() {
  local section=""
  
  for cat in Added Changed Fixed Reverted; do
    local cat_entries=$(echo "$MERGED_CONTENT" | jq -r --arg cat "$cat" '.entries[] | select(.category == $cat) | .entry')
    if [[ -n "$cat_entries" ]]; then
      if [[ -n "$section" ]]; then
        section="${section}

"
      fi
      section="${section}### ${cat}

${cat_entries}"
    fi
  done
  
  echo "$section"
}

NEW_SECTION=$(build_section)

# If dry-run, just output the section and exit
if [[ "$DRY_RUN" == "true" ]]; then
  echo "## $TODAY"
  echo ""
  echo "$NEW_SECTION"
  exit 0
fi

# Merge into CHANGELOG.md
if [[ ! -f "$CHANGELOG_PATH" ]]; then
  echo "Error: $CHANGELOG_PATH not found" >&2
  exit 1
fi

# Write new section to a temp file for reliable insertion
SECTION_FILE=$(mktemp)
cleanup_temp_files() {
  if [[ -n "${SECTION_FILE:-}" ]]; then
    rm -f "$SECTION_FILE"
  fi
}
trap cleanup_temp_files EXIT
echo "$NEW_SECTION" > "$SECTION_FILE"

# Check if today's date section exists
if grep -q "## $TODAY" "$CHANGELOG_PATH"; then
  # Replace existing date section using line numbers
  # Find start line (the date header)
  START_LINE=$(grep -n "## $TODAY" "$CHANGELOG_PATH" | head -1 | cut -d: -f1)
  
  # Find end line (next date section or end of file)
  END_LINE=$(tail -n +$((START_LINE + 1)) "$CHANGELOG_PATH" | grep -n "^## " | head -1 | cut -d: -f1 || true)
  
  if [[ -n "$END_LINE" ]]; then
    # There's another date section after - END_LINE is relative to START_LINE+1
    END_LINE=$((START_LINE + END_LINE - 1))
  else
    # No more date sections, but we need to find where meaningful content ends
    # Look for the next section or use a reasonable endpoint
    END_LINE=$(wc -l < "$CHANGELOG_PATH")
  fi
  
  FILE_LENGTH=$(wc -l < "$CHANGELOG_PATH")

  # Build new file: before section + new section + after section
  {
    head -n $((START_LINE - 1)) "$CHANGELOG_PATH"
    echo ""
    echo "## $TODAY"
    echo ""
    cat "$SECTION_FILE"
    echo ""
    if (( END_LINE < FILE_LENGTH )); then
      tail -n +$((END_LINE + 1)) "$CHANGELOG_PATH"
    fi
  } > "${CHANGELOG_PATH}.tmp"
  mv "${CHANGELOG_PATH}.tmp" "$CHANGELOG_PATH"
else
  # Add new date section after the --- separator
  SEPARATOR_LINE=$(grep -n "^---$" "$CHANGELOG_PATH" | head -1 | cut -d: -f1)
  
  if [[ -n "$SEPARATOR_LINE" ]]; then
    {
      head -n "$SEPARATOR_LINE" "$CHANGELOG_PATH"
      echo ""
      echo "## $TODAY"
      echo ""
      cat "$SECTION_FILE"
      echo ""
      tail -n +$((SEPARATOR_LINE + 1)) "$CHANGELOG_PATH"
    } > "${CHANGELOG_PATH}.tmp"
    mv "${CHANGELOG_PATH}.tmp" "$CHANGELOG_PATH"
  else
    echo "Error: Could not find --- separator in $CHANGELOG_PATH" >&2
    exit 1
  fi
fi

echo "Updated $CHANGELOG_PATH for $TODAY:"
if is_debug_enabled; then
  echo ""
  echo "$NEW_SECTION"
else
  echo "Entries: $ENTRIES_COUNT"
fi
