import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import {
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
  useForm,
} from "react-hook-form";
import type { ZodType } from "zod";

/**
 * The AE's draft/submit pair: the form instance, the failure line, and the two
 * button handlers.
 *
 * WHICH schema runs is set when the BUTTON IS PRESSED, not when it is
 * rendered. This used to be `run(mode)` called during render, setting
 * `intent.current` as a side effect — so whichever button rendered last won,
 * and that was "Save draft". Every "Submit for approval" was therefore
 * validated against the draft schema, which asks for a company name and
 * nothing else. An AE could hand the Delivery Head a PIF with no role, no
 * CTC, no eligibility and no passing years, and the only symptom was an
 * approval queue full of empty forms.
 */
export function usePifIntent<TValues extends FieldValues>(args: {
  /** The draft schema when saving a draft; the submit schema for approval. */
  schemaFor: (intent: "draft" | "submit") => ZodType;
  defaultValues: TValues;
  onCommit: (mode: "draft" | "submit", values: TValues) => Promise<void>;
  onInvalid?: (
    mode: "draft" | "submit",
    errors: import("react-hook-form").FieldErrors<TValues>,
  ) => void;
  failureFallback: string;
}): {
  form: UseFormReturn<TValues>;
  run: (mode: "draft" | "submit") => () => Promise<void>;
  failure: string | null;
} {
  const intent = useRef<"draft" | "submit">("submit");
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<TValues>({
    defaultValues: args.defaultValues as DefaultValues<TValues>,
    // The zod schemas' exact input/output generics do not line up with the
    // form's values type through the hook's indirection; the pair is trusted
    // (both forms pass the schemas their own values type was built from), so
    // the resolver is asserted once, here, instead of argued with generics.
    resolver: (async (values, context, options) => {
      const resolve = zodResolver(args.schemaFor(intent.current) as never) as Resolver<TValues>;
      return resolve(values, context, options);
    }) as Resolver<TValues>,
  });

  const run = (mode: "draft" | "submit") => async () => {
    intent.current = mode;
    await form.handleSubmit(
      async (values) => {
        setFailure(null);
        try {
          await args.onCommit(mode, values);
        } catch (cause) {
          // The repository knows WHY it failed. Replacing that with a blanket
          // apology made a production failure impossible to diagnose, and told
          // the AE to "try again" at something that could never succeed.
          const reason =
            cause instanceof Error && cause.message !== "" ? cause.message : args.failureFallback;
          setFailure(`${reason} Your entries are still here.`);
        }
      },
      (errors) => {
        if (args.onInvalid) {
          args.onInvalid(mode, errors);
        }
      },
    )();
  };

  return { form, run, failure };
}
