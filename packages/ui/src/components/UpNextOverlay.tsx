import './UpNextOverlay.css';

interface Props {
  label: string;
  secondsLeft: number;
  onCancel: () => void;
  onPlayNow: () => void;
}

export function UpNextOverlay({ label, secondsLeft, onCancel, onPlayNow }: Props) {
  return (
    <div className="up-next">
      <div className="up-next__card">
        <div className="up-next__title">Up Next</div>
        <div className="up-next__label">{label}</div>
        <div className="up-next__count">Starting in {secondsLeft}s</div>
        <div className="up-next__actions">
          <button className="up-next__cancel" onClick={onCancel}>Cancel</button>
          <button className="up-next__play" onClick={onPlayNow}>Play now</button>
        </div>
      </div>
    </div>
  );
}
