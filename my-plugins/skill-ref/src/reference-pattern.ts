const NAME_PART = "[^\\s/:\\\\()[\\]{}<>\"'`=,;!?，。；：！？、]+";

export const REFERENCE_PATTERN = `/${NAME_PART}(?::${NAME_PART})*`;
export const REFERENCE_START = "(^|[\\s([{<\"'`=,;!?，。；：！？、])";
export const REFERENCE_END = "(?=$|[\\s)\\]} >\"'`.,;!?，。；：！？、])";
