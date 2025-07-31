#!/usr/bin/env bash

# Ask for a commit message
read -r -p "Enter commit message: " commit_message

# Stage everything
git add .

# Unstage the exclude list
git reset HEAD -- exclude.lst 2>/dev/null

# Unstage any paths listed in exclude.lst
repo_root=$(git rev-parse --show-toplevel)
exclude_file="$repo_root/exclude.lst"
if [[ -f "$exclude_file" ]]; then
  while IFS= read -r path; do
    # skip blank lines and comments
    [[ -z "$path" || "$path" =~ ^# ]] && continue
    git reset HEAD -- "$path" 2>/dev/null
  done < "$exclude_file"
fi

# Commit
git commit -m "$commit_message"
if [[ $? -ne 0 ]]; then
  echo "Nothing to commit or commit failed."
  exit 1
fi

# Confirm and push
while true; do
  read -r -p "Push changes to remote? (y/n): " answer
  case "${answer,,}" in
    y|yes)
      echo "Pushing…"
      git push
      exit $?
      ;;
    n|no)
      echo "Push cancelled."
      exit 0
      ;;
    *)
      echo "Please answer 'y' or 'n'."
      ;;
  esac
done
