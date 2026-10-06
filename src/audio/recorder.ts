/** In-memory recording only. No uploads, transcripts, or attachment writes. */
export class VoiceRecorder {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private disposed = false;
  private pendingStop?: (value: Blob | undefined) => void;
  static supported() {
    return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }
  async start() {
    if (!VoiceRecorder.supported())
      throw new Error('Voice recording is unavailable in this version of Obsidian.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.disposed) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    this.stream = stream;
    try {
      this.recorder = new MediaRecorder(stream);
      this.chunks = [];
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) this.chunks.push(event.data);
      };
      this.recorder.onstop = () => {
        const blob = this.disposed
          ? undefined
          : new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = undefined;
        this.chunks = [];
        this.pendingStop?.(blob);
        this.pendingStop = undefined;
      };
      this.recorder.onerror = () => {
        this.dispose();
      };
      this.recorder.start();
      return true;
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }
  stop(): Promise<Blob | undefined> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve(undefined);
        return;
      }
      this.pendingStop = resolve;
      this.recorder.stop();
    });
  }
  dispose() {
    this.disposed = true;
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.pendingStop?.(undefined);
    this.pendingStop = undefined;
    this.chunks = [];
  }
}
