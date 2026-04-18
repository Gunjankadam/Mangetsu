import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant = "default", ...props }) {
        const isDestructive = variant === "destructive";

        return (
          <Toast key={id} variant={variant} {...props}>
            {isDestructive ? (
              <>
                <div className="grid gap-1 px-5 py-4 pr-11">
                  {title ? <ToastTitle className="text-left">{title}</ToastTitle> : null}
                  {description ? <ToastDescription className="text-left">{description}</ToastDescription> : null}
                  {action}
                </div>
                <ToastClose className="top-1/2 -translate-y-1/2" />
              </>
            ) : (
              <>
                <div className="flex w-full min-w-0 items-stretch">
                  <div className="relative w-[min(34%,7.75rem)] max-w-[124px] shrink-0 overflow-hidden sm:w-[124px]">
                    <img
                      src="/toast-accent.png"
                      alt=""
                      width={248}
                      height={176}
                      className="h-full min-h-[5.75rem] w-full object-cover object-[center_22%] opacity-[0.88]"
                      decoding="async"
                    />
                    <div
                      className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/15 via-background/35 to-background/[0.92]"
                      aria-hidden
                    />
                  </div>
                  <div className="grid min-w-0 flex-1 content-center gap-1 px-4 py-3.5 pr-10">
                    {title ? <ToastTitle className="text-left leading-snug">{title}</ToastTitle> : null}
                    {description ? (
                      <ToastDescription className="text-left text-[13px] leading-snug text-foreground/78">
                        {description}
                      </ToastDescription>
                    ) : null}
                    {action ? <div className="pt-1">{action}</div> : null}
                  </div>
                </div>
                <ToastClose className="top-1/2 -translate-y-1/2" />
              </>
            )}
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
