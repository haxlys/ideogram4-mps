interface QuickPromptExamplesProps {
  suggestions: readonly string[];
  disabled: boolean;
  onSelect: (suggestion: string) => void;
}

export function QuickPromptExamples({ suggestions, disabled, onSelect }: QuickPromptExamplesProps) {
  return (
    <details className="group text-caption">
      <summary className="cursor-pointer list-none text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="underline-offset-2 hover:underline">Example prompts</span>
      </summary>
      <ul className="mt-2 space-y-1 border-l border-border pl-3">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              className="text-left text-caption text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => onSelect(suggestion)}
              disabled={disabled}
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
