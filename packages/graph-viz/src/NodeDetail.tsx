'use client';

import React from 'react';
import { Box, Typography, Paper, IconButton, Chip, Divider } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { KGNode, KGEdge, KGGraphData } from './lib/types';
import { getDepthColor, getRelationColor } from './lib/constants';

interface NodeDetailProps {
  node: KGNode;
  graphData: KGGraphData;
  onClose: () => void;
}

export const NodeDetail: React.FC<NodeDetailProps> = ({ node, graphData, onClose }) => {
  // Find connected edges
  const connectedEdges = graphData.edges.filter(
    e => e.source === node.id || e.target === node.id,
  );

  return (
    <Paper
      elevation={4}
      sx={{
        position: 'absolute',
        top: 8,
        right: 8,
        width: 260,
        maxHeight: '90%',
        overflowY: 'auto',
        p: 2,
        zIndex: 10,
        backgroundColor: 'background.paper',
        borderRadius: 2,
      }}
    >
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight="bold" noWrap sx={{ flex: 1 }}>
          {node.label}
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box display="flex" gap={0.5} flexWrap="wrap" mb={1}>
        {node.depth != null && (
          <Chip
            label={`Depth ${node.depth}`}
            size="small"
            sx={{ backgroundColor: getDepthColor(node.depth), color: '#fff', fontSize: '0.7rem' }}
          />
        )}
        {node.distance != null && (
          <Chip
            label={`Dist: ${node.distance.toFixed(3)}`}
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.7rem' }}
          />
        )}
      </Box>

      {connectedEdges.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary">
            Connections ({connectedEdges.length})
          </Typography>
          <Box display="flex" flexDirection="column" gap={0.5} mt={0.5}>
            {connectedEdges.map((edge) => {
              const isSource = edge.source === node.id;
              const otherNode = isSource ? edge.target : edge.source;
              return (
                <Box
                  key={edge.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    fontSize: '0.75rem',
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: getRelationColor(edge.kind),
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="caption" noWrap>
                    {isSource ? '' : `${otherNode.replace(/_/g, ' ')} `}
                    <b>{edge.kind.replace(/_/g, ' ')}</b>
                    {isSource ? ` ${otherNode.replace(/_/g, ' ')}` : ''}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </Paper>
  );
};
