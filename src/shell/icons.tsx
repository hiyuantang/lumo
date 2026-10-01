// SPDX-License-Identifier: AGPL-3.0-only
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconHome(p: IconProps) {
  return base(
    p,
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10.5V20h12v-9.5" />
      <path d="M10 20v-5h4v5" />
    </>,
  );
}

export function IconImage(p: IconProps) {
  return base(p, <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 18 6-6 4 4 3-3 4 5"/></>);
}

export function IconFolder(p: IconProps) {
  return base(
    p,
    <>
      <path d="M3.5 6.5h6l2 2.5h9v9.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-12Z" />
    </>,
  );
}

export function IconFile(p: IconProps) {
  return base(
    p,
    <>
      <path d="M6 3.5h8L18.5 8v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5V8.5H19" />
    </>,
  );
}

export function IconTerminal(p: IconProps) {
  return base(
    p,
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="m7 9.5 3 2.75L7 15" />
      <path d="M12.5 15.5H17" />
    </>,
  );
}

export function IconThinking(p: IconProps) {
  return base(p, <><path d="M7 16a4 4 0 0 1-3-6.6A4.5 4.5 0 0 1 10 4a4.5 4.5 0 0 1 7.6 1.8A4.5 4.5 0 0 1 18 15h-7"/><circle cx="8" cy="18" r="1.5"/><circle cx="4" cy="21" r=".7" fill="currentColor" stroke="none"/></>);
}

export function IconGear(p: IconProps) {
  return base(
    p,
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M9.8 3h4.4l.6 2.5 1.5.9 2.5-.7L21 9.5l-1.9 1.8v1.4l1.9 1.8-2.2 3.8-2.5-.7-1.5.9-.6 2.5H9.8l-.6-2.5-1.5-.9-2.5.7L3 14.5l1.9-1.8v-1.4L3 9.5l2.2-3.8 2.5.7 1.5-.9L9.8 3Z" />
    </>,
  );
}

export function IconList(p: IconProps) {
  return base(
    p,
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
    </>,
  );
}

export function IconBell(p: IconProps) {
  return base(
    p,
    <>
      <path d="M6 16.5v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 16.5Z" />
      <path d="M10 21a2.1 2.1 0 0 0 4 0" />
    </>,
  );
}

export function IconSearch(p: IconProps) {
  return base(
    p,
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>,
  );
}

export function IconUser(p: IconProps) {
  return base(
    p,
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c1.2-3.4 3.9-5 7-5s5.8 1.6 7 5" />
    </>,
  );
}

export function IconChevronRight(p: IconProps) {
  return base(p, <path d="m9 5 7 7-7 7" />);
}

export function IconChevronDown(p: IconProps) {
  return base(p, <path d="m6 9 6 6 6-6" />);
}

export function IconX(p: IconProps) {
  return base(p, <path d="m6 6 12 12M18 6 6 18" />);
}

export function IconPlus(p: IconProps) {
  return base(p, <path d="M12 5v14M5 12h14" />);
}

export function IconMinus(p: IconProps) {
  return base(p, <path d="M5.5 12h13" />);
}

export function IconZoom(p: IconProps) {
  return base(
    p,
    <>
      <path d="M9 15H6.5A1.5 1.5 0 0 1 5 13.5v-7A1.5 1.5 0 0 1 6.5 5h7A1.5 1.5 0 0 1 15 6.5V9" />
      <rect x="9" y="9" width="10" height="10" rx="1.5" />
    </>,
  );
}

export function IconEyeOff(p: IconProps) {
  return base(p, <><path d="M3 3l18 18M9 6.3a10 10 0 0 1 3-.5c6 0 9.5 6.2 9.5 6.2a20 20 0 0 1-3 3.8M6 7.6A22 22 0 0 0 2.5 12s3.5 6.2 9.5 6.2c1.5 0 2.8-.3 4-.8M10 10a2.8 2.8 0 0 0 4 4"/></>);
}

export function IconEye(p: IconProps) {
  return base(
    p,
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>,
  );
}

export function IconUpload(p: IconProps) {
  return base(
    p,
    <>
      <path d="M12 15V3.5m-4 4 4-4 4 4" />
      <path d="M4.5 14v5.5h15V14" />
    </>,
  );
}

export function IconPause(p: IconProps) {
  return base(p, <path d="M9 5.5v13M15 5.5v13" />);
}

export function IconPlay(p: IconProps) {
  return base(p, <path d="M8 5.5v13l10-6.5-10-6.5Z" />);
}

export function IconChip(p: IconProps) {
  return base(
    p,
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
      <rect x="10" y="10" width="4" height="4" rx="0.8" />
      <path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" />
    </>,
  );
}

export function IconNetwork(p: IconProps) {
  return base(
    p,
    <>
      <path d="M7 4v9M4.5 10.5 7 13l2.5-2.5" />
      <path d="M17 20v-9M14.5 13.5 17 11l2.5 2.5" />
    </>,
  );
}

export function IconBoxes(p: IconProps) {
  return base(p, <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.5"/></>);
}

export function IconGrid(p: IconProps) {
  return base(p, <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>);
}

export function IconGlobe(p: IconProps) {
  return base(p, <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5.2 6.5h13.6M5.2 17.5h13.6"/></>);
}

export function IconCode(p: IconProps) {
  return base(p, <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m9 9-3 3 3 3m6-6 3 3-3 3"/></>);
}

export function IconMore(p: IconProps) {
  return base(p, <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>);
}
export function IconArchive(p: IconProps) {
  return base(p, <path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/>);
}
export function IconTrash(p: IconProps) {
  return base(p, <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>);
}

export function IconMonitor(p: IconProps) {
  return base(p, <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 12h3l2-5 2 8 2-3h2M8 21h8M12 18v3"/></>);
}

export function IconRefresh(p: IconProps) {
  return base(p, <><path d="M20 14a8.25 8.25 0 1 1-1-6.5"/><path d="M19 3v4.5h-4.5"/></>);
}

export function IconSkills(p: IconProps) {
  return base(p, <><path d="M4 5.5C7 4 9.5 4.5 12 6c2.5-1.5 5-2 8-.5v14c-3-1.5-5.5-1-8 .5-2.5-1.5-5-2-8-.5zM12 6v14M7 9h2M7 12h2M15 9h2M15 12h2"/></>);
}

export function IconDownload(p: IconProps) {
  return base(p, <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></>);
}

export function IconSidebar(p: IconProps) {
  return base(p, <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>);
}

export function IconCopy(p: IconProps) {
  return base(p, <><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></>);
}

export function IconBranch(p: IconProps) {
  return base(p, <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 7v2a4 4 0 0 1-4 4h-4a4 4 0 0 0-4 4"/></>);
}

export function IconChatBubble(p: IconProps) {
  return base(p, <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z"/>);
}

export function IconSend(p: IconProps) {
  return base(p, <path d="M12 20V4m-6 6 6-6 6 6"/>);
}

export function IconStop(p: IconProps) {
  return base(p, <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>);
}

export function IconPet(p: IconProps) {
  return base(p, <><ellipse cx="6" cy="9" rx="2" ry="2.5"/><ellipse cx="10" cy="5" rx="2" ry="2.5"/><ellipse cx="16" cy="6" rx="2" ry="2.5"/><ellipse cx="20" cy="11" rx="2" ry="2.5"/><path d="M8 15c1-2 2-3 4-3s3 1 4 3l2 3c1 3-2 4-4 3l-2-1-2 1c-3 1-5-1-4-3Z"/></>);
}

export function IconNewChat(p: IconProps) {
  return base(p, <path d="M10 4H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-4M15 4l5 5M10 14l-1 4 4-1 8-8a2 2 0 0 0-5-5z"/>);
}

export function IconPi(p: IconProps) {
  return base(p, <><path d="M4 7h16M8 7v9c0 2-1 3-2 3M16 7v10c0 2 2 2 3 1" strokeWidth={2}/></>);
}
