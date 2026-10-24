import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useVerifyAccessKey } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, ChevronRight, Clapperboard, Film, HardDrive, LockKeyhole, Plus, ShieldCheck, Trash2, Upload, UserRound, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

type Video = { id: string; name: string; size: number; type: string; createdAt: number; blob: Blob };
type Profile = { name: string; age: number };
type Role = 'admin' | 'viewer';

const queryClient = new QueryClient();
const DB_NAME = 'little-reel-library';
const STORE_NAME = 'videos';

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open this device’s library.'));
  });
}

async function readVideos(): Promise<Video[]> {
  const db = await openLibrary();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { db.close(); resolve((request.result as Video[]).sort((a, b) => b.createdAt - a.createdAt)); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function saveVideo(file: File): Promise<Video> {
  const db = await openLibrary();
  const video: Video = { id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type || 'video/mp4', createdAt: Date.now(), blob: file };
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(video);
    request.onsuccess = () => { db.close(); resolve(video); };
    request.onerror = () => { db.close(); reject(request.error ?? new Error(`Could not save ${file.name}.`)); };
  });
}

async function removeVideo(id: string): Promise<void> {
  const db = await openLibrary();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => { db.close(); resolve(); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AppContent() {
  const verify = useVerifyAccessKey();
  const [phase, setPhase] = useState<'access' | 'profile' | 'library'>('access');
  const [role, setRole] = useState<Role>('viewer');
  const [profile, setProfile] = useState<Profile>({ name: '', age: 0 });
  const [key, setKey] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const videoUrls = useMemo(() => new Map(videos.map(video => [video.id, URL.createObjectURL(video.blob)])), [videos]);
  useEffect(() => () => videoUrls.forEach(url => URL.revokeObjectURL(url)), [videoUrls]);
  useEffect(() => {
    if (phase !== 'library') return;
    setIsLoadingLibrary(true);
    readVideos().then(setVideos).catch(error => setLibraryError(error instanceof Error ? error.message : 'Your library could not be loaded.')).finally(() => setIsLoadingLibrary(false));
  }, [phase]);

  const handleKeySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!key.trim()) return;
    verify.mutate({ data: { key: key.trim() } }, {
      onSuccess: (result) => { setRole(result.role); setPhase('profile'); },
    });
  };

  const enterLibrary = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const age = Number(form.get('age'));
    if (name && Number.isFinite(age) && age >= 0 && age <= 120) {
      setProfile({ name, age });
      setPhase('library');
    }
  };

  const refreshLibrary = async () => {
    try { setVideos(await readVideos()); setLibraryError(''); }
    catch (error) { setLibraryError(error instanceof Error ? error.message : 'Your library could not be refreshed.'); }
  };

  const uploadFiles = async (files: FileList | null) => {
    const chosen = Array.from(files ?? []);
    if (!chosen.length) return;
    setUploadError('');
    const invalid = chosen.find(file => !file.type.startsWith('video/'));
    if (invalid) { setUploadError(`${invalid.name} is not a video file. Choose video clips only.`); return; }
    setProgress({ done: 0, total: chosen.length });
    for (let index = 0; index < chosen.length; index += 1) {
      try {
        await saveVideo(chosen[index]);
        setProgress({ done: index + 1, total: chosen.length });
        await refreshLibrary();
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : `Could not save ${chosen[index].name}.`);
        break;
      }
    }
    setTimeout(() => setProgress(null), 1200);
    if (inputRef.current) inputRef.current.value = '';
  };

  const deleteClip = async (video: Video) => {
    if (!window.confirm(`Remove “${video.name}” from this device?`)) return;
    setDeleting(video.id);
    try { await removeVideo(video.id); await refreshLibrary(); }
    catch (error) { setUploadError(error instanceof Error ? error.message : 'This clip could not be removed.'); }
    finally { setDeleting(null); }
  };

  const startOver = () => {
    setPhase('access'); setKey(''); setProfile({ name: '', age: 0 }); setSelectedVideo(null);
    verify.reset(); setUploadError('');
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Little Reel home" data-testid="link-home">
          <span className="brand-mark"><Clapperboard size={20} strokeWidth={1.8} /></span>
          <span>little reel<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-note"><span className="live-dot" /> A little library, kept close</div>
      </header>

      {phase === 'access' && (
        <section className="welcome-layout" aria-labelledby="welcome-title">
          <div className="welcome-copy">
            <span className="eyebrow"><span className="eyebrow-line" /> YOUR PRIVATE VIDEO SHELF</span>
            <h1 id="welcome-title">A place for<br />the <em>good bits.</em></h1>
            <p className="welcome-description">Family clips, birthday candles, all the moments you want to keep in reach. One key opens your own little corner.</p>
            <div className="shelf-art" aria-hidden="true">
              <div className="art-sun" />
              <div className="art-window"><span /><span /><span /><span /></div>
              <div className="art-shelf"><i /><i /><i /><i /><i /></div>
              <div className="art-caption">the days worth replaying</div>
            </div>
            <div className="privacy-line"><LockKeyhole size={15} /> Saved on this device. Never synced.</div>
          </div>
          <div className="entry-card">
            <div className="entry-number">01 <span>—</span> 03</div>
            <div className="entry-icon"><LockKeyhole size={21} /></div>
            <h2>Come on in</h2>
            <p className="entry-intro">Enter the library key you were given to find your shelf.</p>
            <form onSubmit={handleKeySubmit} className="form-stack">
              <label className="field-label" htmlFor="access-key">Library key</label>
              <input id="access-key" name="key" className="text-field key-field" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder="Your private key" required data-testid="input-access-key" />
              {(verify.isError || libraryError) && <p className="form-error" role="alert" data-testid="status-key-error"><AlertCircle size={15} /> {libraryError || 'That key did not open the library. Check it and try again.'}</p>}
              <button className="button button-primary button-wide" type="submit" disabled={verify.isPending} data-testid="button-enter-library">
                {verify.isPending ? 'Checking your key…' : <>Open my shelf <ChevronRight size={17} /></>}
              </button>
            </form>
            <div className="entry-foot"><ShieldCheck size={16} /> No account. No shared storage. Just this device.</div>
          </div>
        </section>
      )}

      {phase === 'profile' && (
        <section className="center-stage">
          <button className="back-link" onClick={() => setPhase('access')} data-testid="button-back-to-key"><ArrowLeft size={15} /> Back to key</button>
          <div className="entry-card profile-card">
            <div className="entry-number">02 <span>—</span> 03</div>
            <div className="entry-icon"><UserRound size={21} /></div>
            <h2>Who’s watching?</h2>
            <p className="entry-intro">A name helps everyone know who’s in the room.</p>
            <form className="form-stack" onSubmit={enterLibrary}>
              <label className="field-label" htmlFor="profile-name">Your name</label>
              <input className="text-field" id="profile-name" name="name" type="text" autoComplete="given-name" placeholder="What should we call you?" maxLength={48} required data-testid="input-profile-name" />
              <label className="field-label age-label" htmlFor="profile-age">Your age</label>
              <input className="text-field" id="profile-age" name="age" type="number" min="0" max="120" placeholder="Age" required data-testid="input-profile-age" />
              <button className="button button-primary button-wide" type="submit" data-testid="button-continue-profile">Continue to the shelf <ChevronRight size={17} /></button>
            </form>
            <div className="role-note"><span className={`role-dot ${role}`} /> {role === 'admin' ? 'You have the key to add family clips.' : 'You can browse and play the family clips.'}</div>
          </div>
        </section>
      )}

      {phase === 'library' && (
        <section className="library-view">
          <div className="library-heading">
            <div>
              <span className="eyebrow"><span className="eyebrow-line" /> YOUR FAMILY LIBRARY</span>
              <h1>Welcome, <em>{profile.name}.</em></h1>
              <p className="library-subtitle">{profile.age ? `A good day to revisit something.` : 'A good day to revisit something.'}</p>
            </div>
            <div className="library-actions">
              <div className="role-pill"><span className={`role-dot ${role}`} /> {role === 'admin' ? 'Library keeper' : 'Family viewer'}</div>
              <button className="button button-quiet" onClick={startOver} data-testid="button-switch-profile">Switch person</button>
            </div>
          </div>

          <div className="device-banner" role="note" data-testid="status-device-only">
            <span className="banner-icon"><HardDrive size={17} /></span>
            <span><strong>Only on this device.</strong> Your videos stay in this browser and won’t sync or be shared elsewhere.</span>
            <span className="local-badge"><span className="live-dot" /> LOCAL</span>
          </div>

          <div className="shelf-heading">
            <div><span className="eyebrow">THE COLLECTION</span><h2>On the shelf <span className="count-badge" data-testid="text-video-count">{videos.length}</span></h2></div>
            {role === 'admin' && (
              <button className="button button-primary add-button" onClick={() => inputRef.current?.click()} data-testid="button-add-videos">
                <Plus size={17} /> Add videos
              </button>
            )}
            <input ref={inputRef} className="visually-hidden" type="file" accept="video/*" multiple aria-label="Choose multiple video files to add to this device" onChange={event => void uploadFiles(event.target.files)} data-testid="input-video-files" />
          </div>

          {progress && <div className="upload-progress" role="status" data-testid="status-upload-progress">
            <span className="progress-copy"><Upload size={15} /> Saving clips to this device <strong>{progress.done}/{progress.total}</strong></span>
            <div className="progress-track"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
          </div>}
          {uploadError && <div className="notice-error" role="alert" data-testid="status-upload-error"><AlertCircle size={16} /> {uploadError}<button onClick={() => setUploadError('')} aria-label="Dismiss upload error" data-testid="button-dismiss-upload-error"><X size={15} /></button></div>}
          {libraryError && <div className="notice-error" role="alert" data-testid="status-library-error"><AlertCircle size={16} /> {libraryError}<button onClick={() => void refreshLibrary()} data-testid="button-retry-library">Try again</button></div>}

          {isLoadingLibrary ? (
            <div className="video-grid loading-grid" role="status" aria-label="Loading your video shelf" data-testid="status-library-loading">
              <span /><span /><span />
            </div>
          ) : videos.length > 0 ? (
            <div className="video-grid" data-testid="list-video-library">
              {videos.map((video, index) => (
                <article className="video-card" key={video.id} data-testid={`card-video-${video.id}`}>
                  <button className="video-thumb" onClick={() => setSelectedVideo(video)} aria-label={`Play ${video.name}`} data-testid={`button-play-${video.id}`}>
                    <video src={videoUrls.get(video.id)} preload="metadata" muted aria-hidden="true" />
                    <span className="play-mark"><span /></span>
                    <span className="clip-index">{String(index + 1).padStart(2, '0')}</span>
                  </button>
                  <div className="video-meta">
                    <div className="video-title">{video.name}</div>
                    <div className="video-detail"><span>{new Date(video.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span>{formatBytes(video.size)}</span></div>
                  </div>
                  {role === 'admin' && <button className="remove-video" onClick={() => void deleteClip(video)} disabled={deleting === video.id} aria-label={`Remove ${video.name}`} data-testid={`button-delete-${video.id}`}><Trash2 size={15} /></button>}
                </article>
              ))}
            </div>
          ) : !libraryError ? (
            <div className="empty-shelf" data-testid="empty-video-library">
              <div className="empty-art"><Film size={31} strokeWidth={1.35} /></div>
              <span className="eyebrow">THE FIRST REEL</span>
              <h3>Nothing on the shelf. Yet.</h3>
              <p>{role === 'admin' ? 'Add a few clips from this device and make this little library yours.' : 'The shelf is waiting for its first family clip. Ask your library keeper to add one.'}</p>
              {role === 'admin' && <button className="button button-primary" onClick={() => inputRef.current?.click()} data-testid="button-add-first-video"><Plus size={16} /> Add your first videos</button>}
            </div>
          ) : null}

          <footer className="library-footer"><span>Made for your favorite people.</span><span><LockKeyhole size={13} /> This browser only</span></footer>
        </section>
      )}

      {selectedVideo && (
        <div className="player-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) setSelectedVideo(null); }}>
          <section className="player-dialog" role="dialog" aria-modal="true" aria-label={`Playing ${selectedVideo.name}`} data-testid="dialog-video-player">
            <div className="player-top"><span><Clapperboard size={16} /> NOW PLAYING</span><button onClick={() => setSelectedVideo(null)} aria-label="Close video player" data-testid="button-close-player"><X size={19} /></button></div>
            <video className="main-player" src={videoUrls.get(selectedVideo.id)} controls autoPlay playsInline data-testid="video-player" />
            <div className="player-caption"><h2>{selectedVideo.name}</h2><span>{formatBytes(selectedVideo.size)}</span></div>
          </section>
        </div>
      )}
    </main>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
