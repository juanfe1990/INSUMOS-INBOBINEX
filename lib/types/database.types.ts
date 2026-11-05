export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'admin' | 'vendedor' | 'operario';
export type OrderPriority = 'baja' | 'normal' | 'alta' | 'urgente';
export type OrderStatus =
  | 'pendiente'
  | 'en_cola'
  | 'en_embobinado'
  | 'listo_despacho'
  | 'enviado'
  | 'entregado'
  | 'cancelado';
export type FilmType = 'manual' | 'maquina' | 'preestirado' | 'color_negro' | 'color_azul' | 'otro';

export type SupplierCategory =
  | 'materia_prima'
  | 'cores_tubos'
  | 'cintas'
  | 'insumos'
  | 'servicios'
  | 'transporte'
  | 'otro';
export type PurchaseInvoiceStatus = 'pendiente' | 'parcial' | 'pagada' | 'anulada';
export type PaymentMethod = 'transferencia' | 'efectivo' | 'cheque' | 'tarjeta' | 'otro';
export type ReceivableStatus = 'pendiente' | 'parcial' | 'pagado';
export type ExpenseGroup = 'operacional' | 'no_operacional' | 'financiero';
export type ExpenseFrequency = 'quincenal' | 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual' | 'unico';
export type ExpenseStatus = 'pendiente' | 'pagado' | 'anulado';
export type TreasuryAccountType = 'caja_general' | 'banco' | 'caja_menor';
export type TreasuryDirection = 'ingreso' | 'egreso';
export type TreasuryMovementType =
  | 'saldo_inicial' | 'cobro_cliente' | 'pago_proveedor' | 'pago_gasto'
  | 'transferencia_entrada' | 'transferencia_salida' | 'otro_ingreso' | 'otro_egreso' | 'ajuste';
export type PurchaseItemType = 'bobina' | 'core' | 'insumo' | 'otro';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: UserRole;
          phone: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          role?: UserRole;
          phone?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          role?: UserRole;
          phone?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          business_name: string;
          nit_rut: string | null;
          payment_terms_days: number;
          credit_limit: number | null;
          reorder_days: number | null;
          contact_name: string;
          phone: string;
          email: string | null;
          delivery_address: string;
          city: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_name: string;
          nit_rut?: string | null;
          payment_terms_days?: number;
          credit_limit?: number | null;
          reorder_days?: number | null;
          contact_name: string;
          phone: string;
          email?: string | null;
          delivery_address: string;
          city?: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_name?: string;
          nit_rut?: string | null;
          payment_terms_days?: number;
          credit_limit?: number | null;
          reorder_days?: number | null;
          contact_name?: string;
          phone?: string;
          email?: string | null;
          delivery_address?: string;
          city?: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          category_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          image_url: string | null;
          gallery: string[];
          film_type: FilmType | null;
          width_inches: number | null;
          width_cm: number | null;
          caliber_microns: number | null;
          length_meters: number | null;
          weight_kg: number | null;
          core_weight_grams: number | null;
          is_active: boolean;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category_id?: string | null;
          name: string;
          slug: string;
          description?: string | null;
          image_url?: string | null;
          gallery?: string[];
          film_type?: FilmType | null;
          width_inches?: number | null;
          width_cm?: number | null;
          caliber_microns?: number | null;
          length_meters?: number | null;
          weight_kg?: number | null;
          core_weight_grams?: number | null;
          is_active?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          category_id?: string | null;
          name?: string;
          slug?: string;
          description?: string | null;
          image_url?: string | null;
          gallery?: string[];
          film_type?: FilmType | null;
          width_inches?: number | null;
          width_cm?: number | null;
          caliber_microns?: number | null;
          length_meters?: number | null;
          weight_kg?: number | null;
          core_weight_grams?: number | null;
          is_active?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          order_number: number;
          client_id: string;
          created_by: string;
          assigned_operator_id: string | null;
          status: OrderStatus;
          priority: OrderPriority;
          delivery_date: string;
          delivery_address: string;
          notes: string | null;
          total_amount: number;
          subtotal: number;
          apply_vat: boolean;
          vat_rate: number;
          tax_amount: number;
          payment_terms_days: number;
          due_date: string | null;
          paid_amount: number;
          payment_status: ReceivableStatus;
          started_at: string | null;
          completed_at: string | null;
          shipped_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_number?: number;
          client_id: string;
          created_by: string;
          assigned_operator_id?: string | null;
          status?: OrderStatus;
          priority?: OrderPriority;
          delivery_date: string;
          delivery_address: string;
          notes?: string | null;
          total_amount?: number;
          subtotal?: number;
          apply_vat?: boolean;
          vat_rate?: number;
          tax_amount?: number;
          payment_terms_days?: number;
          due_date?: string | null;
          paid_amount?: number;
          payment_status?: ReceivableStatus;
          started_at?: string | null;
          completed_at?: string | null;
          shipped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          order_number?: number;
          client_id?: string;
          created_by?: string;
          assigned_operator_id?: string | null;
          status?: OrderStatus;
          priority?: OrderPriority;
          delivery_date?: string;
          delivery_address?: string;
          notes?: string | null;
          total_amount?: number;
          subtotal?: number;
          apply_vat?: boolean;
          vat_rate?: number;
          tax_amount?: number;
          payment_terms_days?: number;
          due_date?: string | null;
          paid_amount?: number;
          payment_status?: ReceivableStatus;
          started_at?: string | null;
          completed_at?: string | null;
          shipped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      client_order_templates: {
        Row: {
          id: string;
          client_id: string;
          position: number;
          kind: string;
          raw_material_id: string | null;
          core_id: string | null;
          inventory_item_id: string | null;
          core_material_id: string | null;
          weight_grams: number | null;
          quantity: number;
          unit_price: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      waste_records: {
        Row: {
          id: string;
          waste_date: string;
          kind: string;
          raw_material_id: string | null;
          core_id: string | null;
          core_material_id: string | null;
          inventory_item_id: string | null;
          item_name: string;
          unit: string;
          quantity: number;
          unit_cost: number;
          total_cost: number;
          reason: Database['public']['Enums']['waste_reason'];
          order_id: string | null;
          notes: string | null;
          status: string;
          annulled_at: string | null;
          annulled_by: string | null;
          annul_reason: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      film_cut_widths: {
        Row: {
          id: string;
          bobina_width_cm: number;
          roll_width_cm: number;
          rolls_per_pass: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          bobina_width_cm: number;
          roll_width_cm: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          bobina_width_cm?: number;
          roll_width_cm?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          quantity: number;
          completed_quantity: number;
          custom_length_cm: number;
          custom_caliber_microns: number | null;
          bobina_width_cm: number | null;
          rolls_per_pass: number | null;
          weight_grams: number;
          raw_material_id: string | null;
          core_id: string | null;
          core_weight_grams: number;
          film_weight_grams: number | null;
          unit_price: number;
          subtotal: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id: string;
          quantity: number;
          completed_quantity?: number;
          custom_length_cm?: number | null;
          custom_caliber_microns?: number | null;
          bobina_width_cm?: number | null;
          rolls_per_pass?: number | null;
          weight_grams: number;
          raw_material_id?: string | null;
          core_id?: string | null;
          core_weight_grams?: number;
          unit_price?: number;
          subtotal?: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          product_id?: string;
          quantity?: number;
          completed_quantity?: number;
          custom_length_cm?: number | null;
          custom_caliber_microns?: number | null;
          bobina_width_cm?: number | null;
          rolls_per_pass?: number | null;
          weight_grams?: number;
          raw_material_id?: string | null;
          core_id?: string | null;
          core_weight_grams?: number;
          unit_price?: number;
          subtotal?: number;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      production_logs: {
        Row: {
          id: string;
          order_id: string;
          operator_id: string;
          previous_status: OrderStatus;
          new_status: OrderStatus;
          quantity_processed: number;
          waste_kg: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          operator_id: string;
          previous_status: OrderStatus;
          new_status: OrderStatus;
          quantity_processed?: number;
          waste_kg?: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          operator_id?: string;
          previous_status?: OrderStatus;
          new_status?: OrderStatus;
          quantity_processed?: number;
          waste_kg?: number;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      raw_materials: {
        Row: {
          id: string;
          name: string;
          material_type: string;
          color: string;
          width_cm: number;
          caliber_microns: number;
          current_stock_kg: number;
          cost_per_kg: number;
          min_stock_alert_kg: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          material_type?: string;
          color?: string;
          width_cm: number;
          caliber_microns: number;
          current_stock_kg?: number;
          cost_per_kg?: number;
          min_stock_alert_kg?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          material_type?: string;
          color?: string;
          width_cm?: number;
          caliber_microns?: number;
          current_stock_kg?: number;
          cost_per_kg?: number;
          min_stock_alert_kg?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      expense_categories: {
        Row: {
          id: string;
          name: string;
          expense_group: ExpenseGroup;
          puc_code: string | null;
          description: string | null;
          color: string;
          display_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          expense_group?: ExpenseGroup;
          puc_code?: string | null;
          description?: string | null;
          color?: string;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          expense_group?: ExpenseGroup;
          puc_code?: string | null;
          description?: string | null;
          color?: string;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      recurring_expenses: {
        Row: {
          id: string;
          category_id: string;
          name: string;
          payee_name: string | null;
          supplier_id: string | null;
          amount: number;
          is_variable: boolean;
          frequency: ExpenseFrequency;
          due_day: number;
          start_date: string;
          end_date: string | null;
          installments_total: number | null;
          principal_amount: number;
          is_active: boolean;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category_id: string;
          name: string;
          payee_name?: string | null;
          supplier_id?: string | null;
          amount: number;
          is_variable?: boolean;
          frequency?: ExpenseFrequency;
          due_day?: number;
          start_date?: string;
          end_date?: string | null;
          installments_total?: number | null;
          principal_amount?: number;
          is_active?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          category_id?: string;
          name?: string;
          payee_name?: string | null;
          supplier_id?: string | null;
          amount?: number;
          is_variable?: boolean;
          frequency?: ExpenseFrequency;
          due_day?: number;
          start_date?: string;
          end_date?: string | null;
          installments_total?: number | null;
          principal_amount?: number;
          is_active?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          recurring_id: string | null;
          category_id: string;
          description: string;
          payee_name: string | null;
          supplier_id: string | null;
          period_month: string;
          due_date: string;
          amount: number;
          principal_amount: number;
          installment_number: number | null;
          status: ExpenseStatus;
          paid_date: string | null;
          payment_method: PaymentMethod | null;
          reference: string | null;
          account_id: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          recurring_id?: string | null;
          category_id: string;
          description: string;
          payee_name?: string | null;
          supplier_id?: string | null;
          period_month: string;
          due_date: string;
          amount: number;
          principal_amount?: number;
          installment_number?: number | null;
          status?: ExpenseStatus;
          paid_date?: string | null;
          payment_method?: PaymentMethod | null;
          reference?: string | null;
          account_id?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          recurring_id?: string | null;
          category_id?: string;
          description?: string;
          payee_name?: string | null;
          supplier_id?: string | null;
          period_month?: string;
          due_date?: string;
          amount?: number;
          principal_amount?: number;
          installment_number?: number | null;
          status?: ExpenseStatus;
          paid_date?: string | null;
          payment_method?: PaymentMethod | null;
          reference?: string | null;
          account_id?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      treasury_accounts: {
        Row: {
          id: string;
          name: string;
          account_type: TreasuryAccountType;
          puc_code: string | null;
          bank_name: string | null;
          account_number: string | null;
          bank_account_type: string | null;
          opening_balance: number;
          opening_date: string;
          current_balance: number;
          petty_cash_fund: number | null;
          color: string;
          is_active: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          account_type: TreasuryAccountType;
          puc_code?: string | null;
          bank_name?: string | null;
          account_number?: string | null;
          bank_account_type?: string | null;
          opening_balance?: number;
          opening_date?: string;
          current_balance?: number;
          petty_cash_fund?: number | null;
          color?: string;
          is_active?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          account_type?: TreasuryAccountType;
          puc_code?: string | null;
          bank_name?: string | null;
          account_number?: string | null;
          bank_account_type?: string | null;
          opening_balance?: number;
          opening_date?: string;
          current_balance?: number;
          petty_cash_fund?: number | null;
          color?: string;
          is_active?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      treasury_movements: {
        Row: {
          id: string;
          account_id: string;
          movement_date: string;
          direction: TreasuryDirection;
          movement_type: TreasuryMovementType;
          amount: number;
          description: string;
          third_party: string | null;
          reference: string | null;
          support_path: string | null;
          customer_payment_id: string | null;
          supplier_payment_id: string | null;
          expense_id: string | null;
          transfer_group: string | null;
          reconciled: boolean;
          reconciliation_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          movement_date?: string;
          direction: TreasuryDirection;
          movement_type: TreasuryMovementType;
          amount: number;
          description: string;
          third_party?: string | null;
          reference?: string | null;
          support_path?: string | null;
          customer_payment_id?: string | null;
          supplier_payment_id?: string | null;
          expense_id?: string | null;
          transfer_group?: string | null;
          reconciled?: boolean;
          reconciliation_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          movement_date?: string;
          direction?: TreasuryDirection;
          movement_type?: TreasuryMovementType;
          amount?: number;
          description?: string;
          third_party?: string | null;
          reference?: string | null;
          support_path?: string | null;
          customer_payment_id?: string | null;
          supplier_payment_id?: string | null;
          expense_id?: string | null;
          transfer_group?: string | null;
          reconciled?: boolean;
          reconciliation_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      daily_closings: {
        Row: {
          id: string;
          account_id: string;
          closing_date: string;
          system_balance: number;
          counted_balance: number;
          difference: number;
          adjustment_movement_id: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          closing_date: string;
          system_balance: number;
          counted_balance: number;
          difference?: number;
          adjustment_movement_id?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          closing_date?: string;
          system_balance?: number;
          counted_balance?: number;
          difference?: number;
          adjustment_movement_id?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      bank_reconciliations: {
        Row: {
          id: string;
          account_id: string;
          statement_date: string;
          statement_balance: number;
          book_balance: number;
          movements_count: number;
          support_path: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          statement_date: string;
          statement_balance: number;
          book_balance: number;
          movements_count?: number;
          support_path?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          statement_date?: string;
          statement_balance?: number;
          book_balance?: number;
          movements_count?: number;
          support_path?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      customer_payments: {
        Row: {
          id: string;
          order_id: string;
          payment_date: string;
          amount: number;
          withholding_amount: number;
          method: PaymentMethod;
          reference: string | null;
          account_id: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          payment_date?: string;
          amount: number;
          withholding_amount?: number;
          method?: PaymentMethod;
          reference?: string | null;
          account_id?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          payment_date?: string;
          amount?: number;
          withholding_amount?: number;
          method?: PaymentMethod;
          reference?: string | null;
          account_id?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      order_products: {
        Row: {
          id: string;
          order_id: string;
          kind: string;
          inventory_item_id: string | null;
          raw_material_id: string | null;
          core_id: string | null;
          core_material_id: string | null;
          description: string;
          unit: string;
          quantity: number;
          unit_price: number;
          subtotal: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          kind: string;
          inventory_item_id?: string | null;
          raw_material_id?: string | null;
          core_id?: string | null;
          core_material_id?: string | null;
          description: string;
          unit: string;
          quantity: number;
          unit_price?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          kind?: string;
          inventory_item_id?: string | null;
          raw_material_id?: string | null;
          core_id?: string | null;
          core_material_id?: string | null;
          description?: string;
          unit?: string;
          quantity?: number;
          unit_price?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      inventory_categories: {
        Row: {
          id: string;
          name: string;
          display_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          display_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          display_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      inventory_items: {
        Row: {
          id: string;
          category_id: string | null;
          name: string;
          sku: string | null;
          unit: string;
          current_stock: number;
          avg_cost: number;
          sale_price: number | null;
          min_stock_alert: number;
          is_active: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category_id?: string | null;
          name: string;
          sku?: string | null;
          unit?: string;
          current_stock?: number;
          avg_cost?: number;
          sale_price?: number | null;
          min_stock_alert?: number;
          is_active?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          category_id?: string | null;
          name?: string;
          sku?: string | null;
          unit?: string;
          current_stock?: number;
          avg_cost?: number;
          sale_price?: number | null;
          min_stock_alert?: number;
          is_active?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      core_materials: {
        Row: {
          id: string;
          name: string;
          current_stock_kg: number;
          cost_per_kg: number;
          min_stock_alert_kg: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          current_stock_kg?: number;
          cost_per_kg?: number;
          min_stock_alert_kg?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          current_stock_kg?: number;
          cost_per_kg?: number;
          min_stock_alert_kg?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      core_specifications: {
        Row: {
          id: string;
          name: string;
          length_cm: number;
          weight_grams: number;
          standard_cost: number;
          current_stock_units: number;
          min_stock_alert_units: number;
          core_material_id: string | null;
          labor_cost_per_unit: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          length_cm: number;
          weight_grams?: number;
          standard_cost?: number;
          current_stock_units?: number;
          min_stock_alert_units?: number;
          core_material_id?: string | null;
          labor_cost_per_unit?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          length_cm?: number;
          weight_grams?: number;
          standard_cost?: number;
          current_stock_units?: number;
          min_stock_alert_units?: number;
          core_material_id?: string | null;
          labor_cost_per_unit?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      inventory_transactions: {
        Row: {
          id: string;
          movement_type: 'entrada_compra' | 'produccion_core' | 'consumo_pedido' | 'merma_desperdicio' | 'ajuste_manual' | 'anulacion_compra' | 'consumo_armado_core' | 'salida_venta' | 'consumo_interno';
          raw_material_id: string | null;
          core_id: string | null;
          core_material_id: string | null;
          inventory_item_id: string | null;
          quantity: number;
          unit_cost: number;
          total_cost: number;
          order_id: string | null;
          purchase_invoice_id: string | null;
          waste_record_id: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          movement_type: 'entrada_compra' | 'produccion_core' | 'consumo_pedido' | 'merma_desperdicio' | 'ajuste_manual' | 'anulacion_compra' | 'consumo_armado_core' | 'salida_venta' | 'consumo_interno';
          raw_material_id?: string | null;
          core_id?: string | null;
          core_material_id?: string | null;
          inventory_item_id?: string | null;
          quantity: number;
          unit_cost?: number;
          total_cost?: number;
          order_id?: string | null;
          purchase_invoice_id?: string | null;
          notes?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          movement_type?: 'entrada_compra' | 'produccion_core' | 'consumo_pedido' | 'merma_desperdicio' | 'ajuste_manual' | 'anulacion_compra' | 'consumo_armado_core' | 'salida_venta' | 'consumo_interno';
          raw_material_id?: string | null;
          core_id?: string | null;
          core_material_id?: string | null;
          inventory_item_id?: string | null;
          quantity?: number;
          unit_cost?: number;
          total_cost?: number;
          order_id?: string | null;
          purchase_invoice_id?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      suppliers: {
        Row: {
          id: string;
          business_name: string;
          nit: string | null;
          verification_digit: number | null;
          category: SupplierCategory;
          contact_name: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          city: string;
          payment_terms_days: number;
          bank_name: string | null;
          bank_account_type: 'ahorros' | 'corriente' | null;
          bank_account_number: string | null;
          is_active: boolean;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          business_name: string;
          id?: string;
          nit?: string | null;
          verification_digit?: number | null;
          category?: SupplierCategory;
          contact_name?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          city?: string;
          payment_terms_days?: number;
          bank_name?: string | null;
          bank_account_type?: 'ahorros' | 'corriente' | null;
          bank_account_number?: string | null;
          is_active?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_name?: string;
          nit?: string | null;
          verification_digit?: number | null;
          category?: SupplierCategory;
          contact_name?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          city?: string;
          payment_terms_days?: number;
          bank_name?: string | null;
          bank_account_type?: 'ahorros' | 'corriente' | null;
          bank_account_number?: string | null;
          is_active?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      purchase_invoices: {
        Row: {
          id: string;
          supplier_id: string;
          invoice_number: string;
          cufe: string | null;
          issue_date: string;
          due_date: string;
          subtotal: number;
          tax_amount: number;
          withholding_amount: number;
          total: number;
          paid_amount: number;
          status: PurchaseInvoiceStatus;
          annulled_reason: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          supplier_id: string;
          invoice_number: string;
          due_date: string;
          id?: string;
          cufe?: string | null;
          issue_date?: string;
          subtotal?: number;
          tax_amount?: number;
          withholding_amount?: number;
          paid_amount?: number;
          status?: PurchaseInvoiceStatus;
          annulled_reason?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          supplier_id?: string;
          invoice_number?: string;
          cufe?: string | null;
          issue_date?: string;
          due_date?: string;
          subtotal?: number;
          tax_amount?: number;
          withholding_amount?: number;
          paid_amount?: number;
          status?: PurchaseInvoiceStatus;
          annulled_reason?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      purchase_invoice_items: {
        Row: {
          id: string;
          invoice_id: string;
          item_type: PurchaseItemType;
          raw_material_id: string | null;
          core_id: string | null;
          core_material_id: string | null;
          inventory_item_id: string | null;
          description: string;
          quantity: number;
          unit: string;
          unit_cost: number;
          subtotal: number;
          created_at: string;
        };
        Insert: {
          invoice_id: string;
          item_type: PurchaseItemType;
          description: string;
          quantity: number;
          unit_cost: number;
          id?: string;
          raw_material_id?: string | null;
          core_id?: string | null;
          core_material_id?: string | null;
          inventory_item_id?: string | null;
          unit?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          item_type?: PurchaseItemType;
          raw_material_id?: string | null;
          core_id?: string | null;
          core_material_id?: string | null;
          inventory_item_id?: string | null;
          description?: string;
          quantity?: number;
          unit?: string;
          unit_cost?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      supplier_payments: {
        Row: {
          id: string;
          invoice_id: string;
          payment_date: string;
          amount: number;
          method: PaymentMethod;
          reference: string | null;
          account_id: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          invoice_id: string;
          amount: number;
          id?: string;
          payment_date?: string;
          method?: PaymentMethod;
          reference?: string | null;
          account_id?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          payment_date?: string;
          amount?: number;
          method?: PaymentMethod;
          reference?: string | null;
          account_id?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      register_purchase_invoice: {
        Args: { p_invoice: Json; p_items: Json };
        Returns: string;
      };
      annul_purchase_invoice: {
        Args: { p_invoice_id: string; p_reason: string };
        Returns: undefined;
      };
      register_core_assembly: {
        Args: { p_core_id: string; p_units: number; p_notes?: string };
        Returns: Json;
      };
      register_treasury_movement: {
        Args: {
          p_account_id: string;
          p_direction: TreasuryDirection;
          p_type: TreasuryMovementType;
          p_amount: number;
          p_date: string;
          p_description: string;
          p_third_party?: string;
          p_reference?: string;
        };
        Returns: string;
      };
      transfer_between_accounts: {
        Args: { p_from: string; p_to: string; p_amount: number; p_date: string; p_description?: string; p_reference?: string };
        Returns: string;
      };
      register_daily_closing: {
        Args: { p_account_id: string; p_date: string; p_counted: number; p_create_adjustment?: boolean; p_notes?: string };
        Returns: Json;
      };
      close_bank_reconciliation: {
        Args: { p_account_id: string; p_statement_date: string; p_statement_balance: number; p_movement_ids: string[]; p_notes?: string };
        Returns: string;
      };
      undo_bank_reconciliation: {
        Args: { p_reconciliation_id: string };
        Returns: undefined;
      };
      income_statement: {
        Args: { p_from: string; p_to: string; p_basis?: string; p_client?: string; p_tax_rate?: number };
        Returns: Json;
      };
      financial_dashboard: {
        Args: Record<string, never>;
        Returns: Json;
      };
      generate_recurring_expenses: {
        Args: { p_month: string };
        Returns: number;
      };
      adjust_raw_material_stock: {
        Args: { p_raw_id: string; p_new_stock_kg: number; p_unit_cost?: number; p_notes?: string };
        Returns: undefined;
      };
      adjust_core_stock: {
        Args: { p_core_id: string; p_new_units: number; p_notes?: string };
        Returns: undefined;
      };
      replace_client_templates: {
        Args: { p_data: Json };
        Returns: number;
      };
      clients_dashboard: {
        Args: { p_from: string; p_to: string };
        Returns: Json;
      };
      register_waste: {
        Args: {
          p_kind: string;
          p_ref_id: string;
          p_quantity: number;
          p_reason?: Database['public']['Enums']['waste_reason'];
          p_order_id?: string;
          p_notes?: string;
          p_date?: string;
        };
        Returns: string;
      };
      annul_waste: {
        Args: { p_id: string; p_reason: string };
        Returns: undefined;
      };
      film_rolls_per_pass: {
        Args: { p_bobina_width: number; p_roll_width: number };
        Returns: number | null;
      };
      create_order: {
        Args: { p_order: Json; p_stretch: Json | null; p_products: Json };
        Returns: Json;
      };
      register_inventory_exit: {
        Args: { p_item_id: string; p_movement: string; p_quantity: number; p_notes?: string };
        Returns: number;
      };
      adjust_inventory_item_stock: {
        Args: { p_item_id: string; p_new_stock: number; p_unit_cost?: number; p_notes?: string };
        Returns: undefined;
      };
      adjust_core_material_stock: {
        Args: { p_material_id: string; p_new_stock_kg: number; p_notes?: string };
        Returns: undefined;
      };
    };
    Enums: {
      waste_reason: 'refile' | 'arranque' | 'rollo_defectuoso' | 'rotura' | 'core_danado' | 'dano_bodega' | 'obsoleto' | 'otro';
      receivable_status: ReceivableStatus;
      expense_group: ExpenseGroup;
      expense_frequency: ExpenseFrequency;
      expense_status: ExpenseStatus;
      treasury_account_type: TreasuryAccountType;
      treasury_direction: TreasuryDirection;
      treasury_movement_type: TreasuryMovementType;
      user_role: UserRole;
      order_priority: OrderPriority;
      order_status: OrderStatus;
      film_type: FilmType;
      supplier_category: SupplierCategory;
      purchase_invoice_status: PurchaseInvoiceStatus;
      payment_method: PaymentMethod;
      purchase_item_type: PurchaseItemType;
      inventory_movement_type:
        | 'entrada_compra'
        | 'produccion_core'
        | 'consumo_pedido'
        | 'merma_desperdicio'
        | 'ajuste_manual'
        | 'anulacion_compra'
        | 'consumo_armado_core'
        | 'salida_venta'
        | 'consumo_interno';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
