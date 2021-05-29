# Checks whether we are up to date with the main branch.

trap "exit 1" ERR

git fetch;

if [[ $? -ne 0 ]]; then
  exit 1;
fi;

BRANCH=$(git branch -v | sed '/^[^*]/d');
BRANCH_NAME=$(echo "$BRANCH" | sed 's/* \([A-Za-z0-9_\-]*\).*/\1/');
BRANCH_SYNC=$(echo "$BRANCH" | sed 's/* [^[]*.\([^]]*\).*/\1/');

if [ "$BRANCH_NAME" != "main" ]; then
  read -p "Current branch is not 'main' but '$BRANCH_NAME'. Continue? (y|N) " answer;
  if [ "$answer" != "y" ] && [ "$answer" != 'Y' ]; then
    exit 1;
  fi;
fi;

if [ "$BRANCH_SYNC" != "" ]; then
  read -p "Current branch is not up to date but '$BRANCH_SYNC'. Continue? (y|N) " answer;
  if [ "$answer" != "y" ] && [ "$answer" != 'Y' ]; then
    exit 1;
  fi;
fi;
