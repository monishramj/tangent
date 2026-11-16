# Scene swap clipping regression

Captured in the Orca browser against one background-QoS, nice-10 Vite server; stopped after capture.
The dev showcase/reel now accepts `swap=1` to give `prev` its own Stage renderer, matching PlayerScreen's scene boundary.

- [Before, t=0.2](before-mid.png): outgoing “OLD FRAME” and KaTeX “OLD” paint across the incoming title.
- [After, t=0.2](after-mid.png): both clip at the moving scene edge; no old pixels enter the incoming half.
- [After, t=0.4](after-end.png): only the incoming scene remains.

The outgoing scene has a 1.15× camera zoom and canvas/KaTeX objects centred at x=1.05, deliberately straddling its viewport.
This also exposes the oversized backdrop leaking past the boundary before the fix.
Both viewports retain the existing deterministic 0.4 s slide/fade, driven by incoming audio time; the queue's 0.6 s hold and audio clock are unchanged.

Reproduce with this URL on the local Vite server (use `window.__draw(t)` to seek):

```
http://localhost:1420/?showcase=title&prev=title&swap=1&t=.2&prevBeat=%7B%22camera%22%3A+%22zoom%22%2C+%22objects%22%3A+%5B%7B%22id%22%3A+%22oldEdge%22%2C+%22type%22%3A+%22text%22%2C+%22text%22%3A+%22OLD+FRAME%22%2C+%22x%22%3A+1.05%2C+%22y%22%3A+0.5%2C+%22size%22%3A+0.12%7D%2C+%7B%22id%22%3A+%22oldMath%22%2C+%22type%22%3A+%22Math%22%2C+%22tex%22%3A+%22OLD%22%2C+%22x%22%3A+1.05%2C+%22y%22%3A+0.7%2C+%22size%22%3A+0.1%7D%5D%2C+%22actions%22%3A+%5B%7B%22at%22%3A+%22%400%22%2C+%22do%22%3A+%22create%22%2C+%22target%22%3A+%22oldEdge%22%7D%2C+%7B%22at%22%3A+%22%400%22%2C+%22do%22%3A+%22create%22%2C+%22target%22%3A+%22oldMath%22%7D%5D%7D&data=%7B%22text%22%3A+%22NEW+FRAME%22%7D
```

`renderer.test.ts` renders two real Pixi scene graphs over the boundary and checks their drawn bounds do not overlap,
checks CSS clip corners against Pixi under camera zoom/shake and resize, checks the outgoing layer is hidden at/after the end,
and repeats frames after backward seek. Against the original renderer it fails: outgoing maxX 1946.54 exceeds the scene edge 992.19.
Native Tauri/WKWebView playback was not checked.
