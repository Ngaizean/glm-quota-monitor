interface Account {
  id: string;
  alias: string;
  level: string | null;
  is_active: boolean;
}

interface Props {
  accounts: Account[];
  selected: string;
  onSelect: (id: string) => void;
}

export default function AccountSwitch({ accounts, selected, onSelect }: Props) {
  if (accounts.length <= 1) return null;

  return (
    <div className="flex gap-1 overflow-x-auto">
      {accounts.map((acc) => (
        <button
          key={acc.id}
          onClick={() => onSelect(acc.id)}
          className={`px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors ${
            selected === acc.id
              ? "bg-blue-600 text-white"
              : "bg-neutral-800 text-neutral-400 hover:text-white"
          }`}
        >
          {acc.alias}
        </button>
      ))}
    </div>
  );
}
