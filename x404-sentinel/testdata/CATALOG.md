# Catalog

Hashes below are of the files in this tree. They are content commits, not blockchain transaction hashes.

## Source — Apollo 11 television

| Field | Value |
| --- | --- |
| File | `testdata/src/Apollo_11_Landing_-_first_steps_on_the_moon.ogv` |
| Work | Neil Armstrong's first steps, Apollo 11 lunar television, 20 July 1969 |
| License | PD-USGov-NASA. NASA material is not protected by copyright unless noted. Wikimedia Commons template PD-USGov. |
| Source page | https://commons.wikimedia.org/wiki/File:Apollo_11_Landing_-_first_steps_on_the_moon.ogv |
| Source URL | https://upload.wikimedia.org/wikipedia/commons/a/a6/Apollo_11_Landing_-_first_steps_on_the_moon.ogv |
| Wikimedia sha1 | `e750af43f2588493ccc90f65585f060bf5b58796` |
| sha256 | `92712e9fddf6c30a6df8828ab1c30ee91d90a7503feb0198f8c9ab15320682cd` |
| bytes | 4568753 |
| Container | Ogg / Theora / Vorbis, 320×240, 24 fps, 61.52 s |

The downloaded sha1 matches the Wikimedia `imageinfo` sha1 for that file.

## Derivative — `apollo11-sstv`

| Field | Value |
| --- | --- |
| File | `testdata/apollo11-sstv.webm` |
| Registry id | `apollo11-sstv` |
| Origin | `nasa-pd-usgov` |
| sha256 | `2c319d60ead708a34c18f93cc3259a5664f7174076a6ff57a5c525d5cce76eb0` |
| bytes | 76211 |
| Picture | 160×120, SAR 1:1, 10 fps, 4.00 s, VP9, no audio |
| In-point | 40.000 s of the source, duration 4.000 s |
| Label | SSTV-style reconstruction |

10 frames per second is the historical Apollo slow-scan television rate class. This file is a compressed derivative of the public NASA television OGV above. It is an SSTV-style reconstruction. It is not a claim to be the lost raw SSTV tapes.

Command (`scripts/compress-apollo.sh`):

```bash
ffmpeg -i testdata/src/Apollo_11_Landing_-_first_steps_on_the_moon.ogv \
  -ss 40 -t 4 -an \
  -vf "scale=160:120:flags=lanczos,fps=10" \
  -pix_fmt yuv420p \
  -c:v libvpx-vp9 -b:v 150k -pass 1 -deadline good -cpu-used 1 -row-mt 1 -g 40 \
  -passlogfile "$TMP/pass" -f null /dev/null
ffmpeg -i testdata/src/Apollo_11_Landing_-_first_steps_on_the_moon.ogv \
  -ss 40 -t 4 -an \
  -vf "scale=160:120:flags=lanczos,fps=10" \
  -pix_fmt yuv420p \
  -c:v libvpx-vp9 -b:v 150k -pass 2 -deadline good -cpu-used 1 -row-mt 1 -g 40 \
  -passlogfile "$TMP/pass" testdata/apollo11-sstv.webm
```

The bytes are grouped into 4096-byte cells with a 448-byte key each, plus a container seal, under `testdata/cells/apollo11-sstv/`.

## Synthetic shim — `mri-shim`

| Field | Value |
| --- | --- |
| File | `testdata/mri-shim.bin` |
| Registry id | `mri-shim` |
| Origin | `synthetic-not-phi` |
| sha256 | `94dc73a0f462e6ed63bb4b4c14da4c0d6022775728cca045a597dfe9bcb8afd2` |
| bytes | 197 |
| Classification | NOT-PHI |

ASCII placeholder for `docs/medical-blueprint.md`. It is not a medical image and not a patient record. No names, no identifiers, no image voxels.
