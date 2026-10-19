import { useRef, useState, type ReactElement } from 'react';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { useCommunity } from '../store.ts';
import { AvatarCropDialog } from './AvatarCrop.tsx';
import { tr } from '../../i18n.ts';

/** A banner from a picture: 960×320, cropped to the middle, as WebP (or PNG). */
async function toBanner(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const W = 960;
  const H = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const scale = Math.max(W / bitmap.width, H / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  canvas.getContext('2d')!.drawImage(bitmap, (W - w) / 2, (H - h) / 2, w, h);
  bitmap.close();
  const webp = canvas.toDataURL('image/webp', 0.8);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.8);
}

/** Community settings → Overview: the community's picture and banner (1.0.29). */
export function CommunityArtFields({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const iconRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const save = (patch: { icon?: string | null; banner?: string | null }): void =>
    void s.run({ a: 'updateArt', communityId: community.id, ...patch }).then((r) => {
      if (r !== null) s.notify(tr('Saved.'));
    });
  return (
    <div className="community-art">
      <div className="community-art__item">
        <span className="field__label">{tr('Picture')}</span>
        {community.art?.icon ? (
          <img className="community-art__icon" src={community.art.icon} alt={tr('Community picture')} />
        ) : (
          <span className="community-art__icon" aria-hidden="true" />
        )}
        <div className="community-art__actions">
          <button className="btn btn--ghost btn--small" onClick={() => iconRef.current?.click()}>
            {tr('Choose…')}
          </button>
          {community.art?.icon && (
            <button className="btn btn--link btn--small" onClick={() => save({ icon: null })}>
              {tr('Remove')}
            </button>
          )}
        </div>
        <input
          ref={iconRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) setCropping(file);
          }}
        />
      </div>
      <div className="community-art__item">
        <span className="field__label">{tr('Banner')}</span>
        {community.art?.banner ? (
          <img className="community-art__banner" src={community.art.banner} alt={tr('Community banner')} />
        ) : (
          <span className="community-art__banner" aria-hidden="true" />
        )}
        <div className="community-art__actions">
          <button className="btn btn--ghost btn--small" onClick={() => bannerRef.current?.click()}>
            {tr('Choose…')}
          </button>
          {community.art?.banner && (
            <button className="btn btn--link btn--small" onClick={() => save({ banner: null })}>
              {tr('Remove')}
            </button>
          )}
        </div>
        <input
          ref={bannerRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void toBanner(file).then(
              (banner) =>
                banner.length > 110_000
                  ? s.notify(tr('That banner is too detailed to keep small; try another picture.'), 'error')
                  : save({ banner }),
              () => s.notify(tr('River could not read that picture.'), 'error'),
            );
          }}
        />
      </div>
      {cropping && (
        <AvatarCropDialog
          file={cropping}
          onClose={() => setCropping(null)}
          onDone={(icon) => {
            setCropping(null);
            save({ icon });
          }}
        />
      )}
      <p className="muted small">{tr('Pictures are end-to-end encrypted like the rest of the community.')}</p>
    </div>
  );
}
