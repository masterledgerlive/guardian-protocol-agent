//! Proven Player — vlc-rs neighbor of the C++ access module.
//! The custom access lives in `vlc-zk-access.cpp`. This crate would:
//!   1. Fetch the follow-the-leader manifest (on-chain loc, never invented).
//!   2. Pull cell bytes from the data field (IPFS / VIN reconstruct).
//!   3. Call the 448-byte key verifier.
//!   4. Pipe unlocked bytes into libVLC memory buffers via vlc-rs.
//!
//! Latency: spawn verify(N+1) while vlc renders N.

#![allow(dead_code)]

pub const ZK_KEY_BYTES: usize = 448;

#[derive(Clone, Debug)]
pub struct Cell {
    pub chunk_id: u32,
    pub payload: Vec<u8>,
    pub key: Vec<u8>,
    pub cell_hash_hex: String,
}

pub fn unlock(cell: &Cell) -> Result<&[u8], &'static str> {
    if cell.key.len() != ZK_KEY_BYTES {
        return Err("key must be 448 bytes — lock stays shut");
    }
    if cell.payload.is_empty() {
        return Err("empty cell");
    }
    Ok(&cell.payload)
}
