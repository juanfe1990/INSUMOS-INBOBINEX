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
          started_at?: string | null;
          completed_at?: string | null;
          shipped_at?: string | null;
          created_at?: string;
          updated_at?: string;
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
          weight_grams: number;
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
          weight_grams: number;
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
          weight_grams: number;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      user_role: UserRole;
      order_priority: OrderPriority;
      order_status: OrderStatus;
      film_type: FilmType;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
