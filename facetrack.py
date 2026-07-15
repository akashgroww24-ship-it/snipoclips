#!/usr/bin/env python3
# Face tracker for smart reframe.
# Usage: facetrack.py <input> <ss> <dur> <targetW> <targetH>
# Prints JSON: {"W","H","cw","ch","track":[[t,cx,cy],...]}  (t is region-relative seconds)
# Always exits 0 with valid JSON; on any problem returns an empty track so the
# caller falls back to a static center crop. Never breaks the render.
import sys, json

def main():
    try:
        inp = sys.argv[1]; ss = float(sys.argv[2]); dur = float(sys.argv[3])
        tw = float(sys.argv[4]); th = float(sys.argv[5])
    except Exception:
        print(json.dumps({"track": []})); return
    try:
        import cv2
    except Exception:
        print(json.dumps({"track": []})); return
    try:
        cap = cv2.VideoCapture(inp)
        W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        vfps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        if W <= 0 or H <= 0 or vfps <= 0:
            print(json.dumps({"track": []})); return
        ar = tw / th
        if W / float(H) > ar:
            cw = int(round(H * ar)); ch = H
        else:
            cw = W; ch = int(round(W / ar))
        cw = max(2, min(cw, W)); ch = max(2, min(ch, H))
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        sample_fps = 3.0
        step = max(1, int(round(vfps / sample_fps)))
        start_frame = int(round(ss * vfps))
        end_frame = int(round((ss + dur) * vfps))
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        min_face = max(24, int(H * 0.08))
        track = []
        idx = start_frame
        while idx < end_frame:
            if not cap.grab():
                break
            if (idx - start_frame) % step == 0:
                ok, frame = cap.retrieve()
                if not ok:
                    break
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                faces = cascade.detectMultiScale(gray, 1.2, 5, minSize=(min_face, min_face))
                if len(faces):
                    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
                    cx = fx + fw / 2.0; cy = fy + fh / 2.0
                    t = (idx - start_frame) / vfps
                    track.append([round(t, 3), round(cx, 1), round(cy, 1)])
            idx += 1
        cap.release()
        print(json.dumps({"W": W, "H": H, "cw": cw, "ch": ch, "track": track}))
    except Exception as e:
        print(json.dumps({"track": [], "err": str(e)[:120]}))

if __name__ == "__main__":
    main()
