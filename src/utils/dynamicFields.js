// Exports a configuration object mapping global asset types to their specific data fields
export const DYNAMIC_FIELDS = {
  // Defines the custom inputs required when 'Camera' is selected
  'Camera': [
    { key: 'resolution', label: 'Max Resolution', placeholder: 'e.g. 8K, 6K, 4K' },
    { key: 'sensor', label: 'Sensor Size', placeholder: 'e.g. Full Frame, Super 35, Micro 4/3' },
    { key: 'mount', label: 'Lens Mount', placeholder: 'e.g. PL, EF, E-Mount' },
    { key: 'media', label: 'Supported Media', placeholder: 'e.g. CFexpress Type B, SDXC' }
  ],
  // Defines the custom inputs required when 'Workstation' or 'Laptop' is selected
  'Workstation': [
    { key: 'cpu', label: 'Processor (CPU)', placeholder: 'e.g. Threadripper PRO 5995WX' },
    { key: 'gpu', label: 'Graphics (GPU)', placeholder: 'e.g. Dual RTX 4090' },
    { key: 'ram', label: 'System Memory (RAM)', placeholder: 'e.g. 128GB DDR5 ECC' },
    { key: 'storage', label: 'Primary Storage', placeholder: 'e.g. 4TB NVMe Gen4 SSD' }
  ],
  'Laptop': [
    { key: 'cpu', label: 'Processor (CPU)', placeholder: 'e.g. Intel Core i9-13980HX' },
    { key: 'gpu', label: 'Graphics (GPU)', placeholder: 'e.g. RTX 4080 Mobile' },
    { key: 'ram', label: 'System Memory (RAM)', placeholder: 'e.g. 64GB DDR5' },
    { key: 'storage', label: 'Primary Storage', placeholder: 'e.g. 2TB NVMe SSD' }
  ],
  // Defines the custom inputs required when 'Monitor' is selected
  'Monitor': [
    { key: 'size', label: 'Screen Size & Aspect', placeholder: 'e.g. 32-inch 16:9' },
    { key: 'panel', label: 'Panel Technology', placeholder: 'e.g. OLED, Mini-LED, IPS' },
    { key: 'refresh', label: 'Refresh Rate', placeholder: 'e.g. 144Hz, 60Hz' }
  ],
  // Defines the custom inputs for drawing/VFX tablets
  'Tablet': [
    { key: 'size', label: 'Active Area Size', placeholder: 'e.g. 24-inch, Medium' },
    { key: 'display', label: 'Has Integrated Display?', placeholder: 'e.g. Yes (Cintiq) / No (Intuos)' },
    { key: 'pen', label: 'Pen Status', placeholder: 'e.g. (WITH a pen), No pen' } // Added the requested pen tracker
  ],
  // Defines the custom inputs for audio equipment
  'Audio Gear': [
    { key: 'type', label: 'Microphone/Device Type', placeholder: 'e.g. Shotgun, Lavalier, Recorder' },
    { key: 'phantom', label: 'Requires Phantom Power?', placeholder: 'e.g. Yes (+48V) / No' },
    { key: 'connector', label: 'Connector Type', placeholder: 'e.g. XLR, 3.5mm, USB-C' }
  ]
};