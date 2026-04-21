#!/bin/bash
# Git Push Script - Clean and Simple

set -e

echo "📤 Pushing code to GitHub..."
git add -A
git commit -m "$1" || echo "No changes to commit"
git push origin main

echo "✅ Push complete"
