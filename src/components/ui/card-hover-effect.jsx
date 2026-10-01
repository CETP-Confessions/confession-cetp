import { cn } from "@/lib/utils";
import { motion } from "motion/react";

export const HoverEffect = ({
  items = [],
  className = "",
  itemClassName = "",
  renderItem,
  onItemClick,
}) => {
  const containerClassName = className
    ? `grid ${className}`
    : "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 items-stretch";

  return (
    <div className={containerClassName}>
      {items.map((item, idx) => {
        const content = renderItem ? renderItem(item, idx) : (
          <>
            <div className="message-topline">
              <span className="public-label">Anonymous Confession</span>
              <time>{item.created_at || "Just now"}</time>
            </div>
            <p className="public-message-text">{item.public_message || item.message || "Anonymous confession"}</p>
          </>
        );

        return (
          <motion.button
            key={item?.id ?? item?.link ?? idx}
            type="button"
            onClick={() => onItemClick?.(item)}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.995 }}
            className={cn(
              "group relative flex h-full w-full flex-col overflow-hidden rounded-[24px] border border-[rgba(148,163,184,0.35)] bg-white text-left shadow-[0_12px_24px_rgba(15,23,42,0.04)] transition-all duration-200 hover:border-[rgba(123,111,175,0.5)] hover:shadow-[0_18px_30px_rgba(123,111,175,0.12)]",
              itemClassName,
            )}
          >
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(123,111,175,0.08),transparent_58%)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
            <span className="relative z-10 flex h-full w-full flex-col">{content}</span>
          </motion.button>
        );
      })}
    </div>
  );
};
