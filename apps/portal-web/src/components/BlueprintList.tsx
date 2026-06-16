import type { BlueprintSummary } from '../types';

interface Props {
  blueprints: BlueprintSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function BlueprintList({ blueprints, selectedId, onSelect }: Props) {
  if (blueprints.length === 0) {
    return <p className="muted">No blueprints available.</p>;
  }
  return (
    <ul className="blueprint-list">
      {blueprints.map((bp) => (
        <li key={bp.id}>
          <button
            type="button"
            className={`blueprint-card${bp.id === selectedId ? ' is-selected' : ''}`}
            onClick={() => onSelect(bp.id)}
          >
            <span className="blueprint-card__name">{bp.name}</span>
            <span className="blueprint-card__desc">{bp.description}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
