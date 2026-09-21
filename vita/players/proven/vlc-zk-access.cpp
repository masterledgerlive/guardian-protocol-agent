/**
 * Proven Player — libVLC custom access module (boilerplate).
 *
 * Injected into the libVLC pipeline BEFORE native demux/decode:
 *   1. Read heavy cell bytes + 448-byte key from the data field / stream.
 *   2. Run the local zk-verifier (vita_zk_verify_cell).
 *   3. If the lock opens, write unlocked bytes into the access buffer
 *      that libVLC's H.264/HEVC decoder consumes.
 *   4. If the proof fails, drop the cell — never execute tampered data.
 *
 * Prefetch: start verifying cell N+1 while libVLC renders cell N so the
 * client buffer never starves (edge pipeline).
 *
 * Build (when libvlc headers are present):
 *   gcc -shared -fPIC -o libaccess_vita_zk.so vlc-zk-access.cpp -lvlc
 *
 * Never invent a loc. Keys that are not 448 bytes fail closed.
 */

#include <cstdint>
#include <cstring>
#include <vector>
#include <string>

static const size_t VITA_ZK_KEY_BYTES = 448;

struct VitaZkCell {
    uint32_t chunk_id;
    std::vector<uint8_t> payload;
    std::vector<uint8_t> key; // 448 bytes
    std::string cell_hash_hex;
};

/** Neighboring JS/Rust verifier is the source of truth; this is the C ABI. */
extern "C" int vita_zk_verify_cell(
    const uint8_t *payload, size_t payload_len,
    const uint8_t *key, size_t key_len
);

/**
 * Access/Open: fail closed on size or verify miss.
 * Returns 0 and fills unlocked when the lock opens.
 */
int vita_zk_access_unlock(const VitaZkCell &cell, std::vector<uint8_t> *unlocked) {
    if (!unlocked) return -1;
    if (cell.key.size() != VITA_ZK_KEY_BYTES) return -2;
    if (cell.payload.empty()) return -3;
    int ok = vita_zk_verify_cell(
        cell.payload.data(), cell.payload.size(),
        cell.key.data(), cell.key.size()
    );
    if (ok != 1) return -4; // drop corrupted / unproven chunk
    *unlocked = cell.payload;
    return 0;
}

#ifdef VITA_LIBVLC_HEADERS
#include <vlc_common.h>
#include <vlc_plugin.h>
#include <vlc_access.h>

static int Open(vlc_object_t *obj) {
    access_t *access = (access_t *)obj;
    (void)access;
    /* Stream URL: vitazk://<manifest-loc>/<chunk> — loc must be a real 0x hash. */
    return VLC_SUCCESS;
}

static void Close(vlc_object_t *obj) {
    (void)obj;
}

vlc_module_begin()
    set_shortname("vita-zk")
    set_description("VITA Proven Player ZK access")
    set_capability("access", 10)
    add_shortcut("vitazk")
    set_callbacks(Open, Close)
vlc_module_end()
#endif
