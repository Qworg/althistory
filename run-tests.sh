#!/bin/bash

BACKEND_EXIT=0
FRONTEND_EXIT=0

echo "=== Running Backend Tests ==="
cd timeline
npm test || BACKEND_EXIT=$?
cd ..

echo ""
echo "=== Running Frontend Tests ==="
cd frontend
npm test || FRONTEND_EXIT=$?
cd ..

echo ""
echo "=== Test Summary ==="
echo "Backend exit code: $BACKEND_EXIT"
echo "Frontend exit code: $FRONTEND_EXIT"

if [ $BACKEND_EXIT -ne 0 ] || [ $FRONTEND_EXIT -ne 0 ]; then
  exit 1
fi
