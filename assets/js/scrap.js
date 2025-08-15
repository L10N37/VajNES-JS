/* DELETE THIS FILE, ITS JUST for scrap coding trials
Frame Buffer Arrays 

delete all local changes and revert to last push

git fetch origin && \
git reset --hard origin/$(git rev-parse --abbrev-ref HEAD) && \
git clean -fd

-----------------------------------------
First index = Y (scanline)
Second index = X (pixel in that scanline)
Value = pixel colour index 0–3
-----------------------------------------
*/
frameBufferNTSC[240][256]
frameBufferPAL[240][256]

// Two flat LUTs — one for low plane, one for high plane of 8px * 8px tiles
const lowPlaneLUT  = new Uint8Array(512 * 8);  // 4096 bytes
const highPlaneLUT = new Uint8Array(512 * 8);  // 4096 bytes

for (let tileIndex = 0; tileIndex < 512; tileIndex++) {
    for (let row = 0; row < 8; row++) {
        // Index into the LUT = tileIndex * 8 + row
        const lutIndex = tileIndex * 8 + row;

        // Low plane bytes are tile[0..7]
        lowPlaneLUT[lutIndex]  = tiles[tileIndex][row];

        // High plane bytes are tile[8..15]
        highPlaneLUT[lutIndex] = tiles[tileIndex][row + 8];
    }
}

/*
const tileIndex = 37; // from nametable or OAM
const rowInTile = 3;  // 0–7, depending on scanline

const lowByte  = lowPlaneLUT[tileIndex * 8 + rowInTile];
const highByte = highPlaneLUT[tileIndex * 8 + rowInTile];
*/

/*
$3F00  Universal background colour (shared by all BG palettes)
$3F01  BG palette 0 - colour 1
$3F02  BG palette 0 - colour 2
$3F03  BG palette 0 - colour 3

$3F04  BG palette 1 - colour 1
$3F05  BG palette 1 - colour 2
$3F06  BG palette 1 - colour 3

$3F08  BG palette 2 - colour 1
$3F09  BG palette 2 - colour 2
$3F0A  BG palette 2 - colour 3

$3F0C  BG palette 3 - colour 1
$3F0D  BG palette 3 - colour 2
$3F0E  BG palette 3 - colour 3
*/

/*

PPUSim_start(60); // run
PPUSim_stop();    // stop
PPUSim_step();    // single frame

*/