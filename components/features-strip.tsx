import { Truck, ShieldCheck, PackageCheck, Handshake } from "lucide-react"

const features = [
  { icon: Truck, label: "Envios", sublabel: "a nivel Nacional" },
  { icon: ShieldCheck, label: "Pagos", sublabel: "100% seguros" },
  { icon: PackageCheck, label: "Ventas", sublabel: "mayoristas" },
  { icon: Handshake, label: "Atencion", sublabel: "personalizada" },
]

export function FeaturesStrip() {
  return (
    <section className="bg-[#2E4040] py-10">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 lg:grid-cols-4">
        {features.map((f) => (
          <div key={f.label} className="flex flex-col items-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#3F8346] text-[#FDFDFD]">
              <f.icon className="h-6 w-6" />
            </div>
            <h3 className="font-heading text-lg font-bold text-[#FDFDFD]">{f.label}</h3>
            <p className="text-sm text-[#C8CDC9]">{f.sublabel}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
