#!/bin/bash

# Simple Git Commit Script
# Run: bash ~/Canteen/git-commit.sh

cd ~/Canteen

echo "Checking git status..."
git status

echo ""
echo "Adding all files..."
git add .

echo ""
echo "Committing changes..."
git commit -m "feat: add deployment automation scripts and comprehensive setup guides"

echo ""
echo "Pushing to GitHub..."
git push origin main

echo ""
echo "✅ All changes committed and pushed!"
echo ""
echo "View on GitHub: https://github.com/DH72367259/Canteen_Application"
