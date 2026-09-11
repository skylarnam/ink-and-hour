export interface Recording {
  id: string;
  title: string;
  artist: string;
  file: string;
  source: string;
  license: string;
}

interface PlayerOptions {
  connect: (media: HTMLAudioElement) => void;
  onChange: () => void;
  onEnded: () => void;
  onError: (message: string) => void;
  createMedia?: () => HTMLAudioElement;
}

export class RecordedMusic {
  private readonly tracks: readonly Recording[];
  private readonly options: PlayerOptions;
  private index: number;
  private media: HTMLAudioElement | null = null;
  private loadedId: string | null = null;
  private requested = false;
  private available = false;
  private playing = false;
  private loading = false;
  private pending: number | null = null;
  private revision = 0;
  private disposed = false;
  private error: string | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(tracks: readonly Recording[], initialId: string, options: PlayerOptions) {
    if (tracks.length === 0) throw new Error('The music collection needs at least one recording.');
    this.tracks = tracks;
    this.options = options;
    this.index = this.trackIndex(initialId);
  }

  get track(): Recording { return this.tracks[this.index]; }

  get state() {
    return {
      track: { ...this.track }, requested: this.requested, available: this.available,
      playing: this.playing, loading: this.loading, error: this.error,
      position: this.media?.currentTime ?? 0,
    };
  }

  adjacent(direction: -1 | 1): Recording {
    return this.tracks[(this.index + direction + this.tracks.length) % this.tracks.length];
  }

  select(id: string): void {
    const index = this.trackIndex(id);
    if (this.disposed || index === this.index) return;
    this.stopMedia();
    this.index = index;
    this.loadedId = null;
    this.error = null;
    if (this.media) {
      this.media.removeAttribute('src');
      this.media.load();
    }
    this.reconcile();
  }

  play(): void {
    if (this.disposed) return;
    this.requested = true;
    this.error = null;
    this.reconcile();
  }

  pause(): void {
    this.requested = false;
    this.stopMedia();
    this.emit();
  }

  setAvailable(available: boolean): void {
    if (this.disposed || this.available === available) return;
    this.available = available;
    this.reconcile();
  }

  private trackIndex(id: string): number {
    const index = this.tracks.findIndex((track) => track.id === id);
    if (index < 0) throw new RangeError(`Unknown recording: ${id}`);
    return index;
  }

  private ensureMedia(): HTMLAudioElement {
    if (this.media) return this.media;
    const media = this.options.createMedia?.() ?? document.createElement('audio');
    media.preload = 'none';
    this.options.connect(media);
    media.addEventListener('playing', this.onPlaying);
    media.addEventListener('waiting', this.onWaiting);
    media.addEventListener('pause', this.onPause);
    media.addEventListener('ended', this.onEnded);
    media.addEventListener('error', this.onMediaError);
    this.media = media;
    return media;
  }

  private reconcile(): void {
    if (!this.requested || !this.available) {
      this.stopMedia();
      this.emit();
      return;
    }
    if (this.playing || this.pending !== null) return;
    const revision = ++this.revision;
    this.pending = revision;
    this.loading = true;
    this.emit();
    try {
      const media = this.ensureMedia();
      if (this.loadedId !== this.track.id) {
        media.src = this.track.file;
        media.load();
        this.loadedId = this.track.id;
      }
      this.startLoadTimeout();
      void media.play().then(() => {
        // A replaced request must not pause a newer track or revive a later user pause.
        if (revision !== this.revision) {
          if (!this.requested || !this.available) media.pause();
          return;
        }
        this.pending = null;
        this.playing = true;
        this.loading = false;
        this.clearLoadTimeout();
        this.emit();
      }, (error: unknown) => {
        if (revision === this.revision) this.fail(error);
      });
    } catch (error) {
      this.fail(error);
    }
  }

  private stopMedia(): void {
    this.revision++;
    this.pending = null;
    this.playing = false;
    this.loading = false;
    this.clearLoadTimeout();
    this.media?.pause();
  }

  private fail(error: unknown): void {
    this.requested = false;
    this.loadedId = null;
    this.stopMedia();
    this.error = error instanceof Error ? error.message : 'The recording could not be played.';
    this.options.onError(`Music could not play. Try this track again or choose another. ${this.error}`);
    this.emit();
  }

  private startLoadTimeout(): void {
    this.clearLoadTimeout();
    this.loadTimer = setTimeout(() => {
      if (!this.disposed && this.requested && this.available && this.loading) {
        this.fail(new Error('The recording took too long to load.'));
      }
    }, 20000);
  }

  private clearLoadTimeout(): void {
    if (this.loadTimer !== null) clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private onPlaying = (): void => {
    if (!this.requested || !this.available || this.disposed) {
      this.media?.pause();
      return;
    }
    this.playing = true;
    this.loading = false;
    this.clearLoadTimeout();
    this.emit();
  };

  private onWaiting = (): void => {
    if (!this.requested || !this.available || this.disposed) return;
    this.playing = false;
    this.loading = true;
    this.startLoadTimeout();
    this.emit();
  };

  private onPause = (): void => {
    if (!this.media?.paused) return;
    this.playing = false;
    this.emit();
  };

  private onEnded = (): void => {
    if (this.requested && this.available && !this.disposed && this.media?.ended) this.options.onEnded();
  };

  private onMediaError = (): void => {
    if (!this.disposed && this.media?.error) {
      this.fail(new Error(this.media.error.message || `Media error ${this.media.error.code}.`));
    }
  };

  private emit(): void { if (!this.disposed) this.options.onChange(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requested = false;
    this.available = false;
    this.stopMedia();
    if (!this.media) return;
    this.media.removeEventListener('playing', this.onPlaying);
    this.media.removeEventListener('waiting', this.onWaiting);
    this.media.removeEventListener('pause', this.onPause);
    this.media.removeEventListener('ended', this.onEnded);
    this.media.removeEventListener('error', this.onMediaError);
    this.media.removeAttribute('src');
    this.media.load();
    this.media = null;
  }
}
