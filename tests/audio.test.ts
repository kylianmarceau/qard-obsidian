// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { VoiceRecorder } from '../src/audio/recorder';
class FakeRecorder {
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void; onerror?: () => void;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['voice']) }); this.onstop?.(); }
}
afterEach(() => { vi.unstubAllGlobals(); });
it('does not request the microphone until used and releases it when stopped', async () => {
  const stop = vi.fn(), getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
  vi.stubGlobal('MediaRecorder', FakeRecorder); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const recorder = new VoiceRecorder(); expect(getUserMedia).not.toHaveBeenCalled();
  await recorder.start(); const blob = await recorder.stop(); expect(blob?.size).toBeGreaterThan(0); expect(stop).toHaveBeenCalledOnce(); recorder.dispose();
});
it('closes a stream if permission resolves after the view was disposed', async () => {
  const stop = vi.fn(); let finish!: (s: unknown) => void;
  vi.stubGlobal('MediaRecorder', FakeRecorder); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(resolve => { finish = resolve; }) } });
  const recorder = new VoiceRecorder(), start = recorder.start(); recorder.dispose(); finish({ getTracks: () => [{ stop }] });
  expect(await start).toBe(false); expect(stop).toHaveBeenCalledOnce();
});
