var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Session } from './Session.entity';
let TradeEntity = class TradeEntity {
    id;
    symbol;
    direction;
    entry_price;
    qty;
    initial_sl;
    current_sl;
    max_rr_achieved;
    min_rr_achieved;
    exit_rr;
    rr_sequence_index;
    entry_ts;
    tp;
    pnl;
    realized_fee;
    funding_fee;
    risk_usdt;
    risk_lock_reason;
    initial_risk_usdt;
    status;
    exit_ts;
    exit_price;
    mark_price;
    last_price;
    exit_reason;
    exit_signal_type;
    exit_signal_reason;
    exit_signals_status;
    entry_signal_type;
    entry_reason;
    entry_signal_reason;
    entry_signal_confidence;
    sl_adjustments;
    active_trade_events;
    _sig_json;
    pnl_pct;
    entry_daily_change_pct;
    binance_order_id;
    binance_close_order_id;
    binance_stop_order_id;
    binance_stop_order_type;
    is_reconciliation;
    close_attempts;
    last_close_attempt_ts;
    close_blocked;
    illiquid_blocked;
    is_knife;
    is_martingale;
    martingale_multiplier;
    martingale_step;
    martingale_threshold_reset;
    updated_at;
    sessionId;
    strategy_label;
    strategy_config;
    live_rr_sequence;
    exit_rr_sequence;
    session;
};
__decorate([
    PrimaryGeneratedColumn('uuid'),
    __metadata("design:type", String)
], TradeEntity.prototype, "id", void 0);
__decorate([
    Column(),
    __metadata("design:type", String)
], TradeEntity.prototype, "symbol", void 0);
__decorate([
    Column(),
    __metadata("design:type", String)
], TradeEntity.prototype, "direction", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "entry_price", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "qty", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "initial_sl", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "current_sl", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "max_rr_achieved", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "min_rr_achieved", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "exit_rr", void 0);
__decorate([
    Column({ default: -1 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "rr_sequence_index", void 0);
__decorate([
    CreateDateColumn(),
    __metadata("design:type", Date)
], TradeEntity.prototype, "entry_ts", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "tp", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "pnl", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "realized_fee", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "funding_fee", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "risk_usdt", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "risk_lock_reason", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "initial_risk_usdt", void 0);
__decorate([
    Index(),
    Column(),
    __metadata("design:type", String)
], TradeEntity.prototype, "status", void 0);
__decorate([
    Index(),
    Column({ type: 'timestamp', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "exit_ts", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "exit_price", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "mark_price", void 0);
__decorate([
    Column('decimal', { precision: 20, scale: 8, nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "last_price", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "exit_reason", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "exit_signal_type", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "exit_signal_reason", void 0);
__decorate([
    Column('jsonb', { nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "exit_signals_status", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "entry_signal_type", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "entry_reason", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "entry_signal_reason", void 0);
__decorate([
    Column('decimal', { precision: 10, scale: 4, default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "entry_signal_confidence", void 0);
__decorate([
    Column('jsonb', { default: [] }),
    __metadata("design:type", Array)
], TradeEntity.prototype, "sl_adjustments", void 0);
__decorate([
    Column('jsonb', { default: [] }),
    __metadata("design:type", Array)
], TradeEntity.prototype, "active_trade_events", void 0);
__decorate([
    Column({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "_sig_json", void 0);
__decorate([
    Column('decimal', { precision: 10, scale: 4, nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "pnl_pct", void 0);
__decorate([
    Column('decimal', { precision: 10, scale: 4, nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "entry_daily_change_pct", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "binance_order_id", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "binance_close_order_id", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "binance_stop_order_id", void 0);
__decorate([
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "binance_stop_order_type", void 0);
__decorate([
    Column({ default: false }),
    __metadata("design:type", Boolean)
], TradeEntity.prototype, "is_reconciliation", void 0);
__decorate([
    Column({ default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "close_attempts", void 0);
__decorate([
    Column('bigint', { nullable: true, transformer: {
            to: (value) => value,
            from: (value) => value ? parseInt(value, 10) : null
        } }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "last_close_attempt_ts", void 0);
__decorate([
    Column({ default: false }),
    __metadata("design:type", Boolean)
], TradeEntity.prototype, "close_blocked", void 0);
__decorate([
    Column({ default: false }),
    __metadata("design:type", Boolean)
], TradeEntity.prototype, "illiquid_blocked", void 0);
__decorate([
    Column({ default: false }),
    __metadata("design:type", Boolean)
], TradeEntity.prototype, "is_knife", void 0);
__decorate([
    Column({ default: false }),
    __metadata("design:type", Boolean)
], TradeEntity.prototype, "is_martingale", void 0);
__decorate([
    Column('decimal', { precision: 10, scale: 4, nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "martingale_multiplier", void 0);
__decorate([
    Column({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "martingale_step", void 0);
__decorate([
    Column({ default: false }),
    __metadata("design:type", Boolean)
], TradeEntity.prototype, "martingale_threshold_reset", void 0);
__decorate([
    UpdateDateColumn(),
    __metadata("design:type", Date)
], TradeEntity.prototype, "updated_at", void 0);
__decorate([
    Index(),
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "sessionId", void 0);
__decorate([
    Index(),
    Column({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "strategy_label", void 0);
__decorate([
    Column('jsonb', { nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "strategy_config", void 0);
__decorate([
    Column('jsonb', { nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "live_rr_sequence", void 0);
__decorate([
    Column('jsonb', { nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "exit_rr_sequence", void 0);
__decorate([
    ManyToOne(() => Session),
    JoinColumn({ name: 'sessionId' }),
    __metadata("design:type", Session)
], TradeEntity.prototype, "session", void 0);
TradeEntity = __decorate([
    Entity(),
    Index(['sessionId', 'status'])
], TradeEntity);
export { TradeEntity };
