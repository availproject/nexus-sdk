#!/bin/bash

# Local CI Test Runner
# This script replicates the CI bundler compatibility tests locally

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Local CI Build Verification${NC}"
echo -e "${BLUE}========================================${NC}"

# Step 1: Build and pack the SDK
echo -e "\n${BLUE}Step 1: Building SDK and creating tarball...${NC}"
cd ..
npm install
npm run build
npm pack

# Get the tarball name
TARBALL=$(ls avail-project-nexus-core-*.tgz | head -1)
echo -e "${GREEN}✓ Created tarball: ${TARBALL}${NC}"

# Step 2: Test each bundler
BUNDLERS=("vite" "nextjs" "webpack" "esbuild")

for bundler in "${BUNDLERS[@]}"; do
  echo -e "\n${BLUE}========================================${NC}"
  echo -e "${BLUE}Testing ${bundler} bundler${NC}"
  echo -e "${BLUE}========================================${NC}"
  
  TEST_DIR="${bundler}-test"
  
  if [ ! -d ".ci-tests/${TEST_DIR}" ]; then
    echo -e "${RED}✗ Test directory not found: .ci-tests/${TEST_DIR}${NC}"
    continue
  fi
  
  cd ".ci-tests/${TEST_DIR}"
  
  # Install dependencies
  echo -e "\n${BLUE}Installing dependencies...${NC}"
  npm install
  
  # Install the SDK tarball
  echo -e "${BLUE}Installing SDK from tarball...${NC}"
  npm install "../../${TARBALL}"
  
  # Build
  echo -e "${BLUE}Building with ${bundler}...${NC}"
  if [ "${bundler}" = "nextjs" ]; then
    npm run build -- --turbo
  else
    npm run build
  fi
  
  # Verify output
  if [ "${bundler}" = "nextjs" ]; then
    if [ ! -d ".next" ]; then
      echo -e "${RED}✗ Build failed: .next directory not found${NC}"
      exit 1
    fi
  else
    if [ ! -d "dist" ]; then
      echo -e "${RED}✗ Build failed: dist directory not found${NC}"
      exit 1
    fi
  fi
  
  echo -e "${GREEN}✓ ${bundler} build successful${NC}"
  
  cd ../..
done

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}All bundler tests passed! ✓${NC}"
echo -e "${GREEN}========================================${NC}"
