import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2 } from 'lucide-react';
import { VoiceRecorder } from './recorder';
export function VoiceAnswer({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [status, setStatus] = useState<'idle' | 'asking' | 'recording'>('idle'),
    [url, setUrl] = useState(''),
    [error, setError] = useState('');
  const recorder = useRef<VoiceRecorder | undefined>(undefined),
    blobUrl = useRef(''),
    alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      recorder.current?.dispose();
      if (blobUrl.current) {
        URL.revokeObjectURL(blobUrl.current);
      }
      onBusy(false);
    },
    [onBusy],
  );
  async function start() {
    setError('');
    setStatus('asking');
    onBusy(true);
    recorder.current?.dispose();
    const current = new VoiceRecorder();
    recorder.current = current;
    try {
      const started = await current.start();
      if (alive.current) {
        setStatus(started ? 'recording' : 'idle');
        onBusy(started);
      }
    } catch {
      if (alive.current) {
        setError('Microphone unavailable or permission declined. You can keep studying normally.');
        setStatus('idle');
        onBusy(false);
      }
    }
  }
  async function stop() {
    const blob = await recorder.current?.stop();
    if (!alive.current) {
      return;
    }
    if (blobUrl.current) {
      URL.revokeObjectURL(blobUrl.current);
    }
    blobUrl.current = blob ? URL.createObjectURL(blob) : '';
    setUrl(blobUrl.current);
    setStatus('idle');
    onBusy(false);
  }
  if (!VoiceRecorder.supported()) {
    return <p className="qard-muted">Voice recording is unavailable on this device.</p>;
  }
  return (
    <div className="qard-voice" data-qard-keyboard-ignore="true">
      {status === 'recording' ? (
        <button onClick={() => void stop()}>
          <Square size={15} />
          Stop recording
        </button>
      ) : (
        <button disabled={status === 'asking'} onClick={() => void start()}>
          <Mic size={16} />
          {status === 'asking' ? 'Waiting for microphone…' : url ? 'Record again' : 'Record answer'}
        </button>
      )}
      {url && (
        <>
          <audio controls src={url} aria-label="Your recorded answer" />
          <button
            aria-label="Discard recording"
            onClick={() => {
              URL.revokeObjectURL(blobUrl.current);
              blobUrl.current = '';
              setUrl('');
            }}
          >
            <Trash2 size={15} />
          </button>
        </>
      )}
      {error && <p role="status">{error}</p>}
    </div>
  );
}
