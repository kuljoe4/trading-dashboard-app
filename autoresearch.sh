#!/bin/bash

# Default values if not set
ITERATIONS=1

# Compile/Build the code (if necessary)
cd backend/node
npm run build > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "METRIC tests_passed=0"
  echo "METRIC tests_failed=810"
  echo "ASI reason=build_failed"
  echo "exit 0" | bash
fi

# Run tests
TEST_OUTPUT=$(npm test 2>&1)

# Extract passed/failed/total from the summary at the bottom
PASSED=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -n 1)
FAILED=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' | head -n 1)

# Default to 0 if empty
PASSED=${PASSED:-0}
FAILED=${FAILED:-0}

# The metric is tests_passed (we want to maximize this)
echo "METRIC tests_passed=$PASSED"
echo "METRIC tests_failed=$FAILED"

if [ "$FAILED" -gt 0 ]; then
  # If tests failed, output some ASI info (e.g. the first failing test name)
  FIRST_FAIL=$(echo "$TEST_OUTPUT" | grep -E '^FAIL ' | head -n 1)
  echo "ASI failed_test=$FIRST_FAIL"
fi
