import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentedControlOption<T>>;
  onValueChange: (value: T) => void;
  "aria-label": string;
  className?: string;
  fullWidth?: boolean;
  orientation?: "horizontal" | "vertical";
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onValueChange,
  className,
  fullWidth = true,
  orientation = "horizontal",
  ...props
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveSelection(currentIndex: number, direction: 1 | -1) {
    if (options.length === 0) return;
    for (let offset = 1; offset <= options.length; offset += 1) {
      const nextIndex = (currentIndex + direction * offset + options.length) % options.length;
      const option = options[nextIndex];
      if (!option.disabled) {
        onValueChange(option.value);
        refs.current[nextIndex]?.focus();
        return;
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const previousKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (event.key === previousKey || event.key === nextKey) {
      event.preventDefault();
      moveSelection(index, event.key === nextKey ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const ordered = event.key === "Home" ? options : [...options].reverse();
      const option = ordered.find((item) => !item.disabled);
      if (!option) return;
      const targetIndex = options.indexOf(option);
      onValueChange(option.value);
      refs.current[targetIndex]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-label={props["aria-label"]}
      aria-orientation={orientation}
      className={["ui-segmented", fullWidth && "ui-segmented--full", className].filter(Boolean).join(" ")}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            className="ui-segmented__item"
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
