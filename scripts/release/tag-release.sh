#!/usr/bin/env bash
# Tags origin/main as vX.Y.Z only when it really is that release:
# the release PR is merged, main's packages say X.Y.Z, and the tag is new.
set -euo pipefail
version="$1"; pr="$2"
state=$(gh pr view "$pr" --json state --jq .state)
[ "$state" = "MERGED" ] || { echo "PR #$pr is $state, not MERGED" >&2; exit 1; }
git fetch -q origin
sha=$(git rev-parse origin/main)
for f in package.json apps/desktop/package.json apps/server/package.json; do
  v=$(git show "$sha:$f" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')
  [ "$v" = "$version" ] || { echo "$f on main is $v, not $version" >&2; exit 1; }
done
if git ls-remote --exit-code --tags origin "v$version" >/dev/null; then echo "tag v$version already exists" >&2; exit 1; fi
git tag -a "v$version" -m "River $version" "$sha"
git push origin "v$version"
echo "tagged v$version at $sha"
