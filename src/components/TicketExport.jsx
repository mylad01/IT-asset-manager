// src/components/TicketExport.jsx // File path definition
import React from 'react'; // Import React library

export default function TicketExport({ ticket, activityLogs }) { // Export main component receiving ticket and logs
  const handlePrint = () => window.print(); // Trigger the browser's native PDF generation and printing

  return ( // Return component JSX
    <div className="p-8 max-w-4xl mx-auto bg-white text-black font-sans"> {/* Main A4-style white container */}
      
      <div className="flex justify-between items-center border-b-2 border-gray-300 pb-4 mb-6"> {/* Top header container with bottom border */}
        <h1 className="text-3xl font-bold">Ticket #{ticket?.id || 'Unknown'}</h1> {/* Render large Ticket ID */}
        <button onClick={handlePrint} className="print:hidden bg-blue-600 text-white px-4 py-2 rounded"> {/* Action button hidden during PDF print */}
          Export to PDF {/* Button label */}
        </button> {/* Close button */}
      </div> {/* Close header */}

      <div className="mb-8 grid grid-cols-2 gap-4 text-sm"> {/* Grid for structured ticket metadata */}
        <div><strong>Title:</strong> {ticket?.title || 'N/A'}</div> {/* Render Title */}
        <div><strong>Status:</strong> {ticket?.status || 'N/A'}</div> {/* Render Status */}
        <div><strong>Created By:</strong> {ticket?.authorName || 'System'}</div> {/* Render Author */}
        <div><strong>Date:</strong> {ticket?.created_at ? new Date(ticket.created_at).toLocaleString() : 'N/A'}</div> {/* Render parsed date */}
      </div> {/* Close metadata grid */}

      <h2 className="text-xl font-bold mb-4 border-b pb-2">Detailed Activity Trail</h2> {/* Section header for logs */}
      <div className="mb-8 space-y-4 text-sm"> {/* Vertical stack for log cards */}
        {activityLogs?.map(log => ( // Safely map through activity log records
          <div key={log.id} className="p-4 bg-gray-50 rounded border border-gray-200"> {/* Log card styling */}
            <div className="font-semibold text-gray-800">{log.action}</div> {/* Render action name */}
            <div className="text-xs text-gray-500 mb-2">User {log.user_id} • {new Date(log.created_at).toLocaleString()}</div> {/* Render user ID and timestamp */}
            
            {log.properties && ( // Conditionally render if properties exist
              <pre className="bg-gray-800 text-green-400 p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap mt-2"> {/* Dark terminal-style block for JSON data */}
                {JSON.stringify(JSON.parse(log.properties), null, 2)} {/* Parse and pretty-print the JSON tracking data */}
              </pre> // Close preformatted block
            )} {/* Close conditional */}
          </div> // Close log card
        ))} {/* Close map function */}
      </div> {/* Close vertical stack */}

      <style>{` /* Inject raw CSS for the print engine */
        @media print { /* Target the PDF/Printer output specifically */
          body { background: white; } /* Force pure white background */
          .print\\:hidden { display: none !important; } /* Hard hide UI buttons from the PDF */
          @page { margin: 20mm; size: A4 portrait; } /* Setup strict A4 sizing and layout margins */
        } /* Close media query */
      `}</style> {/* Close style block */}
    </div> // Close main container
  ); // Close return
} // Close component