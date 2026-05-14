/**
 * Visualization type definitions.
 * Each viz type has a strict props contract the agent must satisfy.
 */

export type BarChartItem = { label: string; value: number | null; color?: string; _date?: string };
export type BarChartProps = { title?: string; items: BarChartItem[]; unit?: string; yMin?: number; yMax?: number; timeMode?: 'sparse' | 'dense' };

export type LineChartPoint = { x: number | string; y: number | null; _date?: string };
export type LineChartSeries = { label?: string; points: LineChartPoint[]; color?: string };
export type LineChartProps = { title?: string; series: LineChartSeries[]; xLabel?: string; yLabel?: string; yMin?: number; yMax?: number; timeMode?: 'sparse' | 'dense' };

export type PieChartSlice = { label: string; value: number; color?: string };
export type PieChartProps = { title?: string; slices: PieChartSlice[] };

export type StatCardProps = { label: string; value: string | number; delta?: string; deltaDirection?: 'up' | 'down' | 'neutral' };

export type TableColumn = { key: string; label: string };
export type TableDisplayProps = { title?: string; columns: TableColumn[]; rows: Record<string, any>[] };

export type ImageDisplayProps = { url: string; alt?: string; caption?: string };

export type JitterPlotPoint = { value: number; label?: string; color?: string; group?: string };
export type JitterPlotCategory = { category: string; points: JitterPlotPoint[] };
export type JitterPlotProps = { title?: string; categories: JitterPlotCategory[]; yLabel?: string; yMin?: number; yMax?: number; pointSize?: number };

export type ExtractionField = { key: string; label: string };
export type ExtractionReviewProps = {
  sources: Array<Record<string, any>>;
  extractions: Record<string, any>;
  source_key?: string;
  fields: ExtractionField[];
  title?: string;
};

export type TodoItem = {
  id: string;
  title: string;
  due_date?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  category?: string;
};

export type RecurringTodoItem = {
  id: string;
  title: string;
  pattern: string;
  done_this_period: number;
  target?: number;
};

export type TodoListProps = {
  overdue: TodoItem[];
  due_today: TodoItem[];
  upcoming_7d: TodoItem[];
  no_date: TodoItem[];
  total_active: number;
  recurring_due: RecurringTodoItem[];
};

export type CalendarDay = {
  date: string;           // "YYYY-MM-DD"
  value?: number;
  done?: boolean;
  label?: string;
  details?: string;
};

export type CalendarProps = {
  title?: string;
  year: number;
  month: number;          // 1-12
  days: CalendarDay[];
  mode?: 'boolean' | 'quantitative';
  unit?: string;
};

export type VizEntry = {
  type: string;
  props: any;
  _ts: number;
  vizId?: string;
};

export type CalibrationProps = Record<string, never>;

export type StarGraphSeed = { subject: string; predicate: string; object: string };
export type StarGraphProps = {
  rootId: string;
  rootLabel: string;
  seeds?: StarGraphSeed[];
  /** If set, reveal seed nodes one-by-one with this delay (ms) between each */
  staggerMs?: number;
};

export type Visualization =
  | { type: 'bar_chart'; props: BarChartProps }
  | { type: 'line_chart'; props: LineChartProps }
  | { type: 'pie_chart'; props: PieChartProps }
  | { type: 'stat_card'; props: StatCardProps }
  | { type: 'table'; props: TableDisplayProps }
  | { type: 'image'; props: ImageDisplayProps }
  | { type: 'jitter_plot'; props: JitterPlotProps }
  | { type: 'extraction_review'; props: ExtractionReviewProps }
  | { type: 'todo_list'; props: TodoListProps }
  | { type: 'calendar'; props: CalendarProps }
  | { type: 'calibration'; props: CalibrationProps }
  | { type: 'star_graph'; props: StarGraphProps };
