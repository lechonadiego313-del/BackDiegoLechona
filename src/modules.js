export const MODULES = [
  ["agua", "Agua potable"],
  ["lyd", "Limpieza y desinfección"],
  ["res", "Residuos sólidos"],
  ["plag", "Control de plagas"],
  ["mant", "Mantenimiento"],
  ["mues", "Muestreo"],
  ["cap", "Formación y capacitación"],
  ["cp", "Control de clientes y proveedores"],
  ["pqrs", "PQRS · Producto no conforme · Recall"],
  ["traz", "Trazabilidad"],
  ["vid", "Vidrio quebradizo"],
  ["aud", "Auditorías internas"],
  ["bpm", "BPM"],
  ["quim", "Sustancias químicas"],
  ["temp", "Control de temperaturas"],
  ["doc", "Control documental"],
];

export const MASTER_CATEGORIES = {
  productos: "Productos",
  areas: "Áreas",
  puntos: "Puntos de muestreo",
  proveedores: "Proveedores",
  clientes: "Clientes",
  equipos: "Equipos / cámaras",
  personal: "Personal",
  superficies: "Superficies",
  utensilios: "Utensilios",
  tipos_plagas: "Tipos de plagas",
};

export const DEFAULT_FORMATS = {
  agua: [
    {
      id: "f_agua",
      name: "Control diario de cloro y pH",
      freq: "Diario",
      fields: [
        { n: "Punto de muestreo", t: "punto", u: "", min: "", max: "" },
        { n: "Cloro residual libre", t: "num", u: "mg/L", min: 0.3, max: 2 },
        { n: "pH", t: "num", u: "", min: 6.5, max: 9 },
        { n: "Color/olor aceptable", t: "chk", u: "", min: "", max: "" },
      ],
    },
  ],
  temp: [
    {
      id: "f_cam",
      name: "Temperatura de cámaras y neveras",
      freq: "Diario",
      fields: [
        { n: "Equipo", t: "equipo", u: "", min: "", max: "" },
        { n: "Temperatura", t: "num", u: "°C", min: 0, max: 4 },
      ],
    },
    {
      id: "f_pt",
      name: "Temperatura de producto en proceso y terminado",
      freq: "Por evento",
      fields: [
        { n: "Producto", t: "producto", u: "", min: "", max: "" },
        { n: "Lote", t: "lote", u: "", min: "", max: "" },
        { n: "Etapa", t: "sel", u: "Cocción,Enfriamiento,Almacenamiento,Producto terminado", min: "", max: "" },
        { n: "Temperatura", t: "num", u: "°C", min: 0, max: 100 },
      ],
    },
  ],
  traz: [
    {
      id: "f_rec",
      name: "Recepción de materia prima",
      freq: "Por evento",
      fields: [
        { n: "Proveedor", t: "proveedor", u: "", min: "", max: "" },
        { n: "Producto", t: "producto", u: "", min: "", max: "" },
        { n: "Lote proveedor", t: "lote", u: "", min: "", max: "" },
        { n: "Cantidad", t: "num", u: "kg", min: "", max: "" },
        { n: "Temperatura de recepción", t: "num", u: "°C", min: 0, max: 4 },
        { n: "Empaque íntegro", t: "chk", u: "", min: "", max: "" },
        { n: "Vencimiento", t: "date", u: "", min: "", max: "" },
      ],
    },
    {
      id: "f_prod",
      name: "Producción / producto en proceso",
      freq: "Por evento",
      fields: [
        { n: "Producto", t: "producto", u: "", min: "", max: "" },
        { n: "Lote interno", t: "lote", u: "", min: "", max: "" },
        { n: "Lote materia prima usada", t: "lote", u: "", min: "", max: "" },
        { n: "Cantidad producida", t: "num", u: "kg", min: "", max: "" },
        { n: "Temp. cocción (centro)", t: "num", u: "°C", min: 75, max: 100 },
        { n: "Temp. enfriamiento", t: "num", u: "°C", min: 0, max: 4 },
      ],
    },
    {
      id: "f_desp",
      name: "Despacho",
      freq: "Por evento",
      fields: [
        { n: "Cliente", t: "cliente", u: "", min: "", max: "" },
        { n: "Producto", t: "producto", u: "", min: "", max: "" },
        { n: "Lote interno", t: "lote", u: "", min: "", max: "" },
        { n: "Cantidad", t: "num", u: "kg", min: "", max: "" },
        { n: "Temperatura despacho", t: "num", u: "°C", min: 60, max: 100 },
        { n: "Vehículo en condiciones", t: "chk", u: "", min: "", max: "" },
      ],
    },
  ],
  lyd: [
    {
      id: "f_lyd",
      name: "Limpieza y desinfección",
      freq: "Diario",
      fields: [
        { n: "Área", t: "area", u: "", min: "", max: "" },
        { n: "Concentración desinfectante", t: "num", u: "ppm", min: 100, max: 200 },
        { n: "Ejecutado", t: "chk", u: "", min: "", max: "" },
      ],
    },
  ],
  plag: [
    {
      id: "f_plag",
      name: "Inspección de plagas",
      freq: "Semanal",
      fields: [
        { n: "Área", t: "area", u: "", min: "", max: "" },
        { n: "Tipo de plaga", t: "tipo_plaga", u: "", min: "", max: "" },
        { n: "Evidencia de plagas", t: "chk", u: "", min: "", max: "" },
        { n: "Estaciones revisadas", t: "num", u: "", min: 0, max: "" },
      ],
    },
  ],
  vid: [
    {
      id: "f_vid",
      name: "Inspección de vidrio y plásticos duros",
      freq: "Mensual",
      fields: [
        { n: "Área", t: "area", u: "", min: "", max: "" },
        { n: "Elementos íntegros", t: "chk", u: "", min: "", max: "" },
      ],
    },
  ],
  bpm: [
    {
      id: "f_bpm",
      name: "Lista de verificación BPM",
      freq: "Semanal",
      fields: [{ n: "Área", t: "area", u: "", min: "", max: "" }, { n: "Cumplimiento", t: "num", u: "%", min: 90, max: 100 }],
    },
  ],
};
