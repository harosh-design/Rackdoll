# Game sound effects

These one-shots were generated locally with Stable Audio 3 Medium (MLX) at
eight sampling steps. The original set used seeds 4101–4113. Softer versions
of the common ball and score cues and dedicated gift, bee, and slime effects
used seeds 5201–5210. The prompts described isolated, warm arcade sports
effects without music or voices. Each output was trimmed to its useful sound,
faded at the edges, peak-normalized, and encoded as mono Ogg Vorbis.

`bump`, `clack`, and `thud` cover ball play. The serve has no separate movement
sound. `perfect`, `counter`,
`rescue`, and `miss` cover special moves. `point` and `lose` signal scoring.
`button`, `rearm`, and `executer` cover hazards.
`gift`, `bee`, and `slime` give the newer power-ups and hazards their own cues.

## Event pack 01

The first extended event pack adds ten stereo sounds generated with the local
Stable Audio 3 Medium MLX model, SAME-L decoder, and eight sampling steps.
The sounds retain their developed body and natural decay. Quiet, decorrelated
room reflections add a little width and space without a prominent echo.
Sources are aligned to their audible onset, faded gently, level-matched, and
encoded as stereo Ogg Vorbis at 44.1 kHz with peak headroom.

| File | Trigger |
| --- | --- |
| `charge.ogg` | A human player starts charging a rally flip; fades on release, cancellation, full charge, pause, or leaving play. |
| `charged.ogg` | The held flip reaches full charge, once per press. |
| `swing.ogg` | A flip is accepted, with volume following its power. |
| `swing-ready.ogg` | A human player's flip cooldown reaches zero. |
| `dive.ogg` | A dive starts successfully. |
| `slide.ogg` | A slide starts successfully. |
| `serve-warning.ogg` | Each of the last three seconds while a human holds the serve; gently rises in pitch. |
| `power-end.ogg` | An active power expires naturally, excluding replacements and resets. |
| `match-win.ogg` | The human wins a solo match, or a local or CPU match ends. |
| `match-lose.ogg` | The human loses a solo match. |

Only the held charge is interrupted; other event sounds keep their spatial
tails. Player cues are panned slightly toward their side of the court.
The pre-existing ball, point, and hazard cues keep their original files.
Prompts, seeds, processing details, and measured durations are recorded in
`event-pack-01.json`. Raw sources and a listening reel are kept locally in
the ignored `output/audio-pack-01/` directory.
