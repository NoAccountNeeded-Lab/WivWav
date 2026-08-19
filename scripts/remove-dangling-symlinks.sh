#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo "usage: $0 DIRECTORY" >&2
  exit 64
fi

# BusyBox find has no GNU -xtype predicate. Test each symlink target instead.
find "$1" -type l -exec sh -c '
  set -eu
  for link do
    if [ ! -e "$link" ]; then
      rm -f "$link"
    fi
  done
' sh '{}' +
