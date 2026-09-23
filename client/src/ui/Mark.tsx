/**
 * The client's mark: the network's hexagon with the horizon line, and in it a
 * mast with a lit lamp instead of the rising sun - the station that listens for the dawn.
 */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <clipPath id="zc-mark">
          <path d="M12 1.6 20.6 6.6v10L12 21.6 3.4 16.6v-10z" />
        </clipPath>
      </defs>
      <g clipPath="url(#zc-mark)">
        <rect x="0" y="15" width="24" height="10" fill="#eeb968" fillOpacity="0.18" />
        <path d="M2 15h20" stroke="#eeb968" strokeWidth="1.4" />
        <path d="M9.3 15 12 8.4l2.7 6.6" fill="none" stroke="#ffdf9f" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M10.4 12.4h3.2" stroke="#ffdf9f" strokeWidth="1.1" />
        <circle cx="12" cy="6.6" r="1.35" fill="#ffdf9f" />
        <path d="M8.9 4.9a4.2 4.2 0 0 0 0 3.4M15.1 4.9a4.2 4.2 0 0 1 0 3.4" fill="none" stroke="#eeb968" strokeWidth="1.1" strokeLinecap="round" />
      </g>
      <path
        d="M12 1.6 20.6 6.6v10L12 21.6 3.4 16.6v-10z"
        fill="none"
        stroke="#eeb968"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}
