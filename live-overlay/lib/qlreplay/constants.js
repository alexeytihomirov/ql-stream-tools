/** QLRP — Quake Live Replay Packed (binary, v1). */
export const QLRP_MAGIC = 0x50524c51; // "QLRP" little-endian
export const QLRP_VERSION = 1;

/** Position sample flags (u8). */
export const POS_F_HEALTH = 1 << 0;
export const POS_F_ARMOR = 1 << 1;
export const POS_F_WEAPON = 1 << 2;
export const POS_F_VEL = 1 << 3;
export const POS_F_LOADOUT = 1 << 4;

export const POS_SCALE = 10; // coords stored as i16 tenths (0.1 qu)
