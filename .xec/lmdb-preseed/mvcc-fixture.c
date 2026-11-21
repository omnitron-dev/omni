/* Synthetic named tables for the real release LMDB. Run only against fresh test directories. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "lmdb.h"

static void check(int rc) { if (rc) { fprintf(stderr, "fixture failed %d\n", rc); exit(1); } }
static int order(const MDB_val *a, const MDB_val *b) {
    uint64_t x, y;
    memcpy(&x, a->mv_data, 8); memcpy(&y, b->mv_data, 8);
    return (x > y) - (x < y);
}

int main(int argc, char **argv) {
    if (argc != 5) return 2;
    MDB_env *e;
    MDB_txn *t;
    MDB_dbi blocks, info, pool, scratch;
    char blob[65536];
    const char *network = "771fbcd656ec1464d3a02ead5e18644030007a0fc664c0a964d30922821a8148";
    memset(blob, 'b', sizeof(blob));
    check(mdb_env_create(&e)); check(mdb_env_set_maxdbs(e, 8)); check(mdb_env_set_mapsize(e, 128ul << 20));
    check(mdb_env_open(e, argv[1], MDB_NOSYNC, 0600));
    check(mdb_txn_begin(e, NULL, 0, &t));
    check(mdb_dbi_open(t, "blocks", MDB_INTEGERKEY | MDB_CREATE, &blocks));
    check(mdb_dbi_open(t, "block_info", MDB_INTEGERKEY | MDB_DUPSORT | MDB_DUPFIXED | MDB_CREATE, &info));
    check(mdb_set_dupsort(t, info, order));
    check(mdb_dbi_open(t, "txpool_blob", MDB_CREATE, &pool));
    uint64_t zero = 0;
    MDB_val key = {8, &zero}, val = {sizeof("private-pool-fixture") - 1, "private-pool-fixture"};
    check(mdb_put(t, pool, &key, &val, 0));
    check(mdb_txn_commit(t));
    for (uint64_t i = strtoull(argv[2], NULL, 10); i < strtoull(argv[3], NULL, 10); ++i) {
        unsigned char row[96] = {0}; memcpy(row, &i, 8);
        for (int j = 0; j < 32; ++j) row[48 + j] = (unsigned char)(i + j);
        if (i == 1 && !getenv("FIXTURE_OTHER_NETWORK")) for (int j = 0; j < 32; ++j) { unsigned int x; sscanf(network + 2*j, "%2x", &x); row[48+j] = x; }
        MDB_val height = {8, &i}, body = {sizeof(blob), blob}, data = {sizeof(row), row};
        check(mdb_txn_begin(e, NULL, 0, &t)); check(mdb_put(t, blocks, &height, &body, MDB_NOOVERWRITE));
        check(mdb_put(t, info, &key, &data, MDB_NODUPDATA)); check(mdb_txn_commit(t));
        usleep(atoi(argv[4]) * 1000);
    }
    if (atoi(argv[2]) == 0) {
        check(mdb_txn_begin(e, NULL, 0, &t)); check(mdb_dbi_open(t, "scratch", MDB_CREATE, &scratch));
        memset(blob, 'F', sizeof(blob)); memcpy(blob, "FREE_OVERFLOW_MARKER_88f74", sizeof("FREE_OVERFLOW_MARKER_88f74") - 1);
        for (uint64_t i = 0; i < 32; i++) {
            MDB_val sk = {8, &i}, sv = {sizeof(blob), blob}; check(mdb_put(t, scratch, &sk, &sv, 0));
        }
        check(mdb_txn_commit(t)); check(mdb_txn_begin(e, NULL, 0, &t)); check(mdb_drop(t, scratch, 1)); check(mdb_txn_commit(t));
    }
    check(mdb_env_sync(e, 1));
    mdb_env_close(e);
    return 0;
}
