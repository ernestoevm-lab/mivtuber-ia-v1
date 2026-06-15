import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "alert"
  | "avatar"
  | "backups"
  | "bolt"
  | "check"
  | "close"
  | "eye"
  | "image"
  | "live"
  | "logs"
  | "menu"
  | "memory"
  | "mic"
  | "model"
  | "monitor"
  | "persona"
  | "power"
  | "safety"
  | "scene"
  | "send"
  | "settings"
  | "sparkle"
  | "speaker"
  | "twitch"
  | "viewers"
  | "voice"
  | "bot"
  | "cpu"
  | "database"
  | "user";

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
  title?: string;
};

const paths: Record<IconName, ReactNode> = {
  alert: <path d="M12 3 2.8 20h18.4L12 3Zm0 6v5m0 3.5h.01" />,
  avatar: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.5-3.5 4.2-5 7-5s5.5 1.5 7 5" /></>,
  backups: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  bot: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4" /><circle cx="9" cy="14" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="14" r="1.3" fill="currentColor" stroke="none" /><path d="M9 18c.7.5 1.7.8 3 .8s2.3-.3 3-.8" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z" />,
  check: <path d="m5 13 4 4L19 7" />,
  close: <path d="M6 6 18 18M18 6 6 18" />,
  eye: <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
  image: <path d="M4 5h16v14H4V5Zm3 10 3.2-3.2 2.3 2.3 3.3-4.1L20 15M8 9h.01" />,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  live: <><circle cx="12" cy="12" r="3.5" /><path d="M5.5 5.5a9 9 0 0 0 0 13" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /><path d="M3 3a13 13 0 0 0 0 18" opacity="0.4" /><path d="M21 3a13 13 0 0 1 0 18" opacity="0.4" /></>,
  logs: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  memory: <><rect x="4" y="6" width="16" height="12" rx="2" /><path d="M8 6V4M12 6V4M16 6V4M8 20v-2M12 20v-2M16 20v-2" /><rect x="8" y="10" width="8" height="4" rx="1" /></>,
  mic: <><rect x="9.5" y="3" width="5" height="12" rx="2.5" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" /><path d="M12 18v3M9 21h6" /></>,
  model: <><path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9L12 3z" /><path d="M3.5 7.5L12 12l8.5-4.5" /><path d="M12 12v9" opacity="0.6" /></>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  persona: <path d="M12 21s-7-4.5-7-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 16.5 12 21 12 21z" />,
  power: <path d="M12 3v9M6.6 6.6a7.5 7.5 0 1 0 10.8 0" />,
  safety: <path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Zm-3 9 2 2 4-5" />,
  scene: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M8 5v14" /></>,
  send: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 14.3a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H10a1.7 1.7 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V10a1.7 1.7 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  sparkle: <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Zm7 13 .8 2.7L22 18l-2.2.6L19 21l-.8-2.4L16 18l2.2-.3L19 15Z" />,
  speaker: <path d="M4 10v4h4l5 4V6L8 10H4Zm12-.5a4 4 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" />,
  twitch: <><path d="M4 5l1.5-2H20v12l-4 4h-4l-3 3v-3H4V5z" /><path d="M10 8v5M15 8v5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20c1-4 4.5-6 8-6s7 2 8 6" /></>,
  viewers: <><circle cx="9" cy="9" r="3.5" /><path d="M2.5 19c.8-2.8 3.4-4.5 6.5-4.5s5.7 1.7 6.5 4.5" /><circle cx="17" cy="7.5" r="2.5" opacity="0.6" /><path d="M16 14.5c2.4.3 4.4 1.8 5 4" opacity="0.6" /></>,
  voice: <><rect x="9.5" y="3" width="5" height="12" rx="2.5" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" /><path d="M12 18v3" /><path d="M9 21h6" /></>
};

export function Icon({ name, size = 18, title, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      fill="none"
      height={size}
      role={title ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
