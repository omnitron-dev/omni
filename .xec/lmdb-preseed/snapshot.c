/* Read a Monero v0.18.5.1 LMDB using that release's own library. */
#include <errno.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "lmdb.h"

/* Version 4 block_info has six uint64 fields, a 32-byte block hash and two uint64 fields. */
static int by_height(const MDB_val *left, const MDB_val *right) {
    uint64_t a = 0, b = 0;
    if (left->mv_size >= sizeof(a)) memcpy(&a, left->mv_data, sizeof(a));
    if (right->mv_size >= sizeof(b)) memcpy(&b, right->mv_data, sizeof(b));
    return (a > b) - (a < b);
}

static int hash_at(MDB_cursor *cursor, uint64_t index, char result[65]) {
    uint64_t zero = 0, found = 0;
    MDB_val key = {sizeof(zero), &zero}, value = {sizeof(index), &index};
    int rc = mdb_cursor_get(cursor, &key, &value, MDB_GET_BOTH);
    if (rc) return rc;
    if (value.mv_size != 96) return MDB_INCOMPATIBLE;
    memcpy(&found, value.mv_data, sizeof(found));
    if (found != index) return MDB_CORRUPTED;
    const unsigned char *hash = (const unsigned char *)value.mv_data + 48;
    for (unsigned int i = 0; i < 32; ++i) snprintf(result + i * 2, 3, "%02x", hash[i]);
    return 0;
}

static int inspect(MDB_env *env, uint64_t checkpoint, const char *expected_genesis, const char *expected_hash) {
    MDB_txn *txn = NULL;
    MDB_cursor *cursor = NULL;
    MDB_dbi blocks, info;
    MDB_stat b, i;
    char genesis[65], network[65], tip[65], anchor[65];
    int rc = mdb_txn_begin(env, NULL, MDB_RDONLY, &txn);
    if (rc) return rc;
    if ((rc = mdb_dbi_open(txn, "blocks", 0, &blocks)) ||
        (rc = mdb_dbi_open(txn, "block_info", 0, &info)) ||
        (rc = mdb_set_dupsort(txn, info, by_height)) ||
        (rc = mdb_stat(txn, blocks, &b)) || (rc = mdb_stat(txn, info, &i))) goto done;
    if (b.ms_entries < 2 || b.ms_entries != i.ms_entries || checkpoint >= b.ms_entries) {
        rc = MDB_INCOMPATIBLE;
        goto done;
    }
    if ((rc = mdb_cursor_open(txn, info, &cursor)) || (rc = hash_at(cursor, 0, genesis)) ||
        (rc = hash_at(cursor, 1, network)) || (rc = hash_at(cursor, b.ms_entries - 1, tip)) ||
        (rc = hash_at(cursor, checkpoint, anchor))) goto done;
    /* The first mainnet checkpoint in the signed release's src/checkpoints/checkpoints.cpp. */
    if (strcmp(network, "771fbcd656ec1464d3a02ead5e18644030007a0fc664c0a964d30922821a8148")) {
        rc = MDB_INCOMPATIBLE;
        goto done;
    }
    if (expected_hash) {
        if (strcmp(genesis, expected_genesis) || strcmp(anchor, expected_hash)) rc = MDB_INCOMPATIBLE;
    } else printf("{\"nettype\":\"mainnet\",\"height\":%" PRIu64 ",\"genesis\":\"%s\",\"tip\":\"%s\","
           "\"checkpointHeight\":%" PRIu64 ",\"checkpointHash\":\"%s\"}\n",
           (uint64_t)b.ms_entries, genesis, tip, checkpoint, anchor);
done:
    if (cursor) mdb_cursor_close(cursor);
    mdb_txn_abort(txn);
    return rc;
}

int main(int argc, char **argv) {
    if (argc == 2 && !strcmp(argv[1], "version")) {
        puts("omnitron-monero-snapshot/1 4f92268d7c16741cfb41e5bbe2aa46cc260a9ea5");
        return 0;
    }
    int compact = argc == 8 && !strcmp(argv[1], "compact");
    int live = argc == 4 && !strcmp(argv[1], "observe-live");
    int sealed = argc == 4 && !strcmp(argv[1], "inspect-offline");
    if ((!compact && !live && !sealed) || sizeof(void *) != 8) return 2;
    uint64_t checkpoint = 0;
    {
        char *end;
        errno = 0;
        checkpoint = strtoull(argv[3], &end, 10);
        if (errno || !*argv[3] || *end || argv[3][0] == '-') return 2;
    }
    MDB_env *env = NULL;
    int rc = mdb_env_create(&env);
    if (!rc) rc = mdb_env_set_maxdbs(env, 4);
    /* Only a sealed, exclusively owned offline copy may bypass the reader lock table. */
    if (!rc) rc = mdb_env_open(env, argv[2], MDB_RDONLY | (sealed ? MDB_NOLOCK | MDB_NOSUBDIR : 0), 0600);
    if (!rc && compact) {
        /* Check the physical file actually opened by LMDB, including replacement between offer and open. */
        mdb_filehandle_t fd;
        struct stat st;
        char dev[32], ino[32];
        rc = mdb_env_get_fd(env, &fd);
        if (!rc && fstat(fd, &st)) rc = errno;
        if (!rc) {
            snprintf(dev, sizeof(dev), "%" PRIuMAX, (uintmax_t)st.st_dev);
            snprintf(ino, sizeof(ino), "%" PRIuMAX, (uintmax_t)st.st_ino);
            if (!S_ISREG(st.st_mode) || st.st_nlink != 1 || strcmp(argv[6], dev) || strcmp(argv[7], ino)) rc = MDB_INCOMPATIBLE;
        }
        if (!rc) rc = inspect(env, checkpoint, argv[4], argv[5]);
        if (!rc) rc = mdb_env_copyfd2(env, STDOUT_FILENO, MDB_CP_COMPACT);
    } else if (!rc) rc = inspect(env, checkpoint, NULL, NULL);
    if (env) mdb_env_close(env);
    if (rc) fprintf(stderr, "Monero LMDB snapshot operation failed (%d).\n", rc);
    return rc ? 1 : 0;
}
