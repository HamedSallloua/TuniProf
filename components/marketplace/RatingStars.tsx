import { StarIcon } from '@/components/ui/icons';

/** Five stars, filled up to the (rounded) average. The text label is given by the caller. */
export function RatingStars({
  average,
  label,
}: {
  average: number;
  label: string;
}) {
  const filled = Math.round(average);
  return (
    <span
      className="inline-flex items-center gap-0.5 text-accent"
      role="img"
      aria-label={label}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} filled={n <= filled} />
      ))}
    </span>
  );
}
