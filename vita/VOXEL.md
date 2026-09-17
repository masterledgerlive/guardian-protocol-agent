# Voxel-truth (docs only)

Not code. Does not replace VITA mother brain (`vitaSave` / `inscribeChunk`).

- **On-chain:** hex payload in `tx.data` / `tx.input` (UTF-8 of compressed truth).
- **Rotate / view:** decode that hex — plain text appears.
- **Superposition:** many truth objects can sit in the same hex stream
  (KEY+LOC, STORE tag, strand header) until a reader picks a view.
- **Prediction:** weight of force is how agents rank which view to read
  next — not a physics engine, not a second inscription path.

`/vitasave` stays as the operator command; default is bank via feed-wrap
(`VITA_AUTO_INSCRIBE` off). Set `yes` to restore mother-brain `vitaSave`.
`/prove` stays the dedicated Eureka letter. The wrap also covers AUTO queue /
learn / vitadata / savesession / btpInscribe / `/vitamothergenesis` MGPLAIN
and POST `/vita/save`. `VITA_MOTHER_GENESIS_AUTO` defaults OFF (bank).
