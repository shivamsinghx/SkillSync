"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  cloneElement,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from "react";
import Image from "next/image";

import { cn } from "@/lib/cn";

import { User, Settings, Mail, ChevronDown } from "lucide-react";

/** Single row in the user menu — action, shortcut, or separator. */
export type UserMenuItem = Readonly<{
  id?: string;
  label?: string;
  icon?: ReactElement;
  kbd?: string;
  danger?: boolean;
  separator?: boolean;
  onClick?: () => void;
}>;

export type UserMenuDropdownProps = Readonly<
  {
    userName?: string;
    userEmail?: string;
    avatarSrc?: string;
    avatarAlt?: string;
    avatarFallback?: string;
    items?: readonly UserMenuItem[];
    onItemClick?: (item: UserMenuItem) => void;
  } & ComponentPropsWithoutRef<"div">
>;

const defaultItems: readonly UserMenuItem[] = [
  { id: "profile", label: "View Profile", icon: <User />, onClick: () => {} },
  {
    id: "settings",
    label: "Account Settings",
    icon: <Settings />,
    kbd: "ctrl + S",
    onClick: () => {},
  },
  {
    id: "messages",
    label: "Messages",
    icon: <Mail />,
    kbd: "ctrl + M",
    onClick: () => {},
  },
  { id: "separator-sign-out", separator: true },
  { id: "sign-out", label: "Sign Out", danger: true, onClick: () => {} },
];

type UserMenuItemRowProps = Readonly<{
  item: UserMenuItem;
  onSelect: (item: UserMenuItem) => void;
}>;

function UserMenuItemRow({ item, onSelect }: UserMenuItemRowProps) {
  if (item.separator) {
    return <hr className="mx-1 my-1 h-px border-0 bg-border" />;
  }

  return (
    <button
      type="button"
      role="menuitem"
      aria-label={item.label}
      onClick={() => onSelect(item)}
      className={cn(
        "group flex w-full cursor-pointer items-center justify-between gap-6 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-colors duration-200",
        item.danger
          ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
          : "text-foreground hover:bg-accent",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {item.icon ? (
          <span
            className={cn(
              "shrink-0 transition-transform duration-300 group-hover:scale-105",
              item.danger ? "text-red-400" : "text-muted-foreground",
            )}
          >
            {cloneElement(
              item.icon as ReactElement<{
                size?: number;
                strokeWidth?: number;
              }>,
              { size: 14, strokeWidth: 2 },
            )}
          </span>
        ) : null}
        <span className="truncate">{item.label}</span>
      </span>

      {item.kbd ? (
        <kbd className="shrink-0 font-mono text-[9px] text-muted-foreground">
          {item.kbd}
        </kbd>
      ) : null}
    </button>
  );
}

// Self-contained user profile menu with a soft spring open animation.
export const UserMenuDropdown = forwardRef<
  HTMLDivElement,
  UserMenuDropdownProps
>(
  (
    {
      userName = "Bidyut Kundu",
      userEmail = "bidyut.kundu.dev@gmail.com",
      avatarSrc,
      avatarAlt = "User",
      avatarFallback = "U",
      items = defaultItems,
      onItemClick,
      className,
      ...props
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const menuId = useId();

    useEffect(() => {
      const closeOnOutside = (event: globalThis.MouseEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) {
          setOpen(false);
        }
      };

      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };

      document.addEventListener("mousedown", closeOnOutside);
      document.addEventListener("keydown", closeOnEscape);
      return () => {
        document.removeEventListener("mousedown", closeOnOutside);
        document.removeEventListener("keydown", closeOnEscape);
      };
    }, []);

    const handleItemSelect = (item: UserMenuItem) => {
      setOpen(false);
      item.onClick?.();
      onItemClick?.(item);
    };

    const toggleOpen = () => setOpen((prev) => !prev);

    return (
      <div
        ref={ref}
        data-slot="user-menu-dropdown"
        className={cn("relative inline-block font-sans", className)}
        {...props}
      >
        <div ref={rootRef} className="relative">
          <button
            type="button"
            aria-label={`User menu for ${userName}`}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-controls={open ? menuId : undefined}
            onClick={toggleOpen}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleOpen();
              }
            }}
            className={cn(
              "group inline-flex h-12 cursor-pointer items-center gap-3 rounded-full border bg-card pr-4 pl-1.5 text-card-foreground transition-all duration-300",
              open ? "border-border" : "border-border/80",
            )}
          >
            <div className="relative size-9 overflow-hidden rounded-full border-2 border-border bg-muted">
              {avatarSrc ? (
                <Image
                  src={avatarSrc}
                  alt={avatarAlt}
                  fill
                  sizes="36px"
                  className="object-cover"
                  unoptimized={avatarSrc.startsWith("http")}
                />
              ) : (
                <span className="flex size-full items-center justify-center text-[11px] font-semibold text-muted-foreground">
                  {avatarFallback}
                </span>
              )}
            </div>
            <div className="min-w-0 max-w-[168px] text-left">
              <p className="truncate text-sm leading-none font-medium text-foreground">
                {userName}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {userEmail}
              </p>
            </div>
            <ChevronDown
              size={14}
              className={cn(
                "shrink-0 text-muted-foreground transition-transform duration-300 ease-out",
                open ? "rotate-180" : "group-hover:translate-y-px",
              )}
            />
          </button>

          {open ? (
            <div
              id={menuId}
              role="menu"
              aria-label={`${userName} menu`}
              className={cn(
                "absolute top-[calc(100%+10px)] right-0 z-100 w-56",
                "origin-top rounded-xl border border-border bg-popover p-1 text-popover-foreground",
                "shadow-[0_20px_50px_-12px_rgba(0,0,0,0.08)] dark:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)]",
                "blur-0 translate-y-0 scale-100 opacity-100",
                "starting:-translate-y-1 starting:scale-[0.96] starting:opacity-0 starting:blur-[3px]",
                "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              )}
            >
              {/* Caret — integrated into the panel, not a separate blob */}
              <span
                aria-hidden
                className="absolute -top-1.25 right-7 size-2.5 rotate-45 border border-r-0 border-b-0 border-border bg-popover"
              />

              <div className="relative">
                {items.map((item) => (
                  <UserMenuItemRow
                    key={item.id ?? item.label ?? "menu-separator"}
                    item={item}
                    onSelect={handleItemSelect}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);

UserMenuDropdown.displayName = "UserMenuDropdown";
