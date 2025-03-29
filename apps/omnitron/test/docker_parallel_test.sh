set -e

docker build -t omnitron-test -f test/Dockerfile .

JOBS=2
OPTS="--jobs $JOBS --joblog joblog-X docker run -v `pwd`:/var/omnitron omnitron-test"

ls test/e2e/cli/* | parallel $OPTS bash

#ls test/e2e/binaries/* test/e2e/modules/* test/e2e/internal/* test/e2e/process-file/* test/e2e/cli/* test/e2e/logs/* | parallel $OPTS bash
