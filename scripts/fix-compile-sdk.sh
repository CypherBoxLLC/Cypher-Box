#!/bin/bash
# Fix node_modules with compileSdkVersion too low for AGP 8+
# Run as part of npm run patches

echo "=== Fixing low compileSdkVersion in node_modules ==="

find node_modules/*/android/build.gradle node_modules/@*/*/android/build.gradle -maxdepth 0 2>/dev/null | while read f; do
  if grep -q "compileSdkVersion [0-9]" "$f" 2>/dev/null; then
    ver=$(grep -o "compileSdkVersion [0-9]*" "$f" | head -1 | awk '{print $2}')
    if [ -n "$ver" ] && [ "$ver" -lt 30 ]; then
      mod=$(echo "$f" | sed 's|node_modules/||' | sed 's|/android/build.gradle||')
      sed -i '' "s/compileSdkVersion $ver/compileSdkVersion 35/" "$f"
      echo "  Fixed $mod: $ver -> 35"
    fi
  fi
done

echo "=== Done ==="
